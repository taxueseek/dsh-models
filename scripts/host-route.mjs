// Host-half test for dsh-models: drives the REAL route handlers that
// lib/host.js installs, against stub `llm` / `webServer` / `sessions` /
// `dispatch` services, and asserts the JSON + control flow the browser half
// and the subagent waterfall depend on.
//
// Why: the routes only exist inside a running host, so this is how their
// assembly logic (cache/backoff, cold-start, sendJson guard, subagent
// GET/POST/DELETE, agent/request override, session cleanup) stays covered
// without restarting the live GUI.
//
// Run: node scripts/host-route.mjs   (pure Node, no dependencies)
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const HOST_PATH = join(root, 'lib', 'host.js')

// ─── tiny assert harness ───
let pass = 0, fail = 0
const failures = []
function ok(name, cond, extra = '') {
  if (cond) { pass++; }
  else { fail++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')) }
}
function eq(name, got, want) { ok(name, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`) }

// ─── stub services + fake ctx ───
let unresolved = null
process.on('unhandledRejection', (e) => { unresolved = e })

function makeLlm(overrides = {}) {
  const calls = { listProviders: 0, listModels: 0, resolveModel: 0, resolveModelInfo: 0 }
  const llm = {
    listProviders() { calls.listProviders++; if (overrides.providersThrows) throw new Error('no providers'); return overrides.providers ?? [
      { id: 'deepseek', name: 'DeepSeek' },
      { id: 'broken', name: 'Broken' },
    ] },
    async listModels(provider) { calls.listModels++; if (provider === 'broken') throw new Error('unreachable'); return [
      { id: 'deepseek-v4-flash', name: 'Flash', inputModalities: ['text'] },
      { id: 'ghost', name: 'Ghost' },
    ] },
    // `resolver` picks which spelling the service exposes, mirroring the two
    // shapes this code has to live with: the real Host LlmRuntime
    // (resolveModelInfo only) and older/stand-in services (resolveModel).
    ...(overrides.resolver === 'none'
      ? {}
      : overrides.resolver === 'both'
        ? {
          async resolveModel(provider, model) { calls.resolveModel++; return { context: { contextWindow: 32000 }, inputModalities: ['text'] } },
          async resolveModelInfo(provider, model) { calls.resolveModelInfo++; if (model === 'ghost') throw new Error('unknown model'); return { provider, id: model, name: model, context: { contextWindow: 128000 }, inputModalities: ['text', 'image'] } },
        }
        : overrides.resolver === 'infoOnly'
          ? { async resolveModelInfo(provider, model) { calls.resolveModelInfo++; if (model === 'ghost') throw new Error('unknown model'); return { provider, id: model, name: model, context: { contextWindow: 128000 }, inputModalities: ['text', 'image'] } } }
          : { async resolveModel(provider, model) { calls.resolveModel++; if (model === 'ghost') throw new Error('unknown model'); return { context: { contextWindow: 128000 }, inputModalities: ['text', 'image'] } } }),
  }
  return { llm, calls }
}

function freshHost(llmOverrides) {
  // A query string busts the ESM cache so each test gets pristine module-level
  // state (cache / cacheRefreshing / dim / subagentRoutes).
  const bust = 'fresh=' + Math.random().toString(36).slice(2)
  return import(HOST_PATH + '?' + bust).then((host) => {
    const { llm, calls } = makeLlm(llmOverrides)
    const routes = new Map()
    const disposers = []
    const dispatch = { 'agent/request': [] }
    const ons = { 'session/disposed': [] }
    const sessions = {}
    const ctx = {
      inject(names, cb) {
        const scope = { llm, sessions }
        const d = cb(scope)
        if (typeof d === 'function') disposers.push(d)
        return d
      },
      webServer: {
        register(spec) {
          routes.set(spec.path, spec.handler)
          let alive = true
          return () => { if (alive) { alive = false; routes.delete(spec.path) } }
        },
      },
      effect(cb) { const d = cb(); if (typeof d === 'function') disposers.push(d); return d },
      dispatch: {
        on(name, handler) { (dispatch[name] ||= []).push(handler); let alive = true; return () => { if (alive) { alive = false; const a = dispatch[name]; const i = a.indexOf(handler); if (i >= 0) a.splice(i, 1) } } },
      },
      on(name, handler) { (ons[name] ||= []).push(handler); let alive = true; return () => { if (alive) { alive = false; const a = ons[name]; const i = a.indexOf(handler); if (i >= 0) a.splice(i, 1) } } },
    }
    host.apply(ctx)
    return { host, routes, disposers, dispatch, ons, calls, llm }
  })
}

function mockReq({ method = 'GET', url, body } = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(body)]
  return { method, url, async *[Symbol.asyncIterator]() { for (const c of chunks) yield c } }
}
function mockRes({ throwOnEnd = false } = {}) {
  const res = { statusCode: 200, headers: {}, headersSent: false, writableEnded: false, _body: undefined, endCalls: 0 }
  res.setHeader = (k, v) => { if (res.headersSent) { const e = new Error('headers after sent'); e.code = 'ERR_HTTP_HEADERS_SENT'; throw e } res.headers[k.toLowerCase()] = v }
  res.end = (b) => { res.headersSent = true; res.writableEnded = true; res.endCalls++; res._body = b; if (throwOnEnd) throw new Error('ECONNRESET') }
  res.json = () => { try { return JSON.parse(res._body) } catch { return null } }
  return res
}
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms))
async function call(routes, path, opts = {}) {
  const handler = routes.get(path)
  if (!handler) throw new Error('no route ' + path)
  const res = opts.res ?? mockRes(opts)
  handler(mockReq(opts), res)
  await tick(opts.wait ?? 30)
  return { status: res.statusCode, json: res.json(), res }
}
// Poll until the background collect lands and the route answers 200. dim (when
// installed) adds ~1.5s of subprocess time, so give it a generous budget.
async function waitWarm(routes, path, budgetMs = 6000) {
  const t0 = Date.now()
  while (Date.now() - t0 < budgetMs) {
    const r = await call(routes, path, { url: path, wait: 50 })
    if (r.status === 200) return r
  }
  return null
}

// dim may or may not be installed; collect tolerates either. Keep the test
// hermetic by not asserting on dim-derived rows.
console.log('host-route.mjs — dsh-models host-half tests')
console.log('dim installed:', existsSync(homedir() + '/.local/bin/dim'))

// ── Group 1: /models cold-start is non-blocking, then warms ──
{
  const h = await freshHost()
  const MODELS = '/api/model-picker/models'
  const t0 = Date.now()
  const cold = await call(h.routes, MODELS, { url: MODELS })
  const coldMs = Date.now() - t0
  ok('cold /models answers fast (non-blocking, <2s)', coldMs < 2000, coldMs + 'ms')
  eq('cold /models is 503', cold.status, 503)
  eq('cold body ok:false', cold.json?.ok, false)
  // background refresh lands; poll until warm
  const warm = await waitWarm(h.routes, MODELS)
  ok('warms to 200 after background collect', !!warm)
  ok('200 payload has the flash row', Array.isArray(warm?.json?.rows) && warm.json.rows.some((r) => r.id === 'deepseek-v4-flash'))
  ok('warm cache-control no-store', warm?.res.headers['cache-control'] === 'no-store')
  // warm path serves immediately without a new collect fan-out
  const before = h.calls.resolveModel
  const again = await call(h.routes, MODELS, { url: MODELS })
  eq('warm /models is 200', again.status, 200)
  ok('warm serves cache (no new resolveModel)', h.calls.resolveModel === before, `${before} -> ${h.calls.resolveModel}`)
}

// ── Group 2: collect failure → 503 + backoff (no per-request re-collect) ──
{
  const h = await freshHost({ providersThrows: true })
  const MODELS = '/api/model-picker/models'
  const r1 = await call(h.routes, MODELS, { url: MODELS, wait: 60 })
  eq('failed collect → 503', r1.status, 503)
  const callsAfterFirst = h.calls.listProviders
  const r2 = await call(h.routes, MODELS, { url: MODELS, wait: 20 })
  eq('backoff: still 503', r2.status, 503)
  ok('backoff: no new collect within window', h.calls.listProviders === callsAfterFirst, `${callsAfterFirst} -> ${h.calls.listProviders}`)
}

// ── Group 3: sendJson guard retires the double-response class ──
{
  const h = await freshHost()
  const MODELS = '/api/model-picker/models'
  // warm the cache first
  let warm = null
  for (let i = 0; i < 40 && !warm; i++) { const r = await call(h.routes, MODELS, { url: MODELS, wait: 50 }); if (r.status === 200) warm = r }
  ok('group3 cache warmed', !!warm)
  unresolved = null
  // Simulate a client that disconnects as the 200 is written: end() flushes
  // headers then throws. The catch's follow-up send must be a no-op.
  const res = mockRes({ throwOnEnd: true })
  const r = await call(h.routes, MODELS, { url: MODELS, res })
  eq('disconnect: no unhandled rejection', unresolved, null)
  ok('disconnect: response sent exactly once', res.endCalls === 1, 'endCalls=' + res.endCalls)
}

// ── Group 4: subagent route GET/POST/DELETE + validation + 405 ──
{
  const h = await freshHost()
  const SUB = '/api/model-picker/subagent'
  const sid = 'sess-1'
  const U = SUB + '?sessionId=' + sid
  eq('GET empty → null route', (await call(h.routes, SUB, { url: U })).json?.route, null)
  eq('GET without sessionId → 400', (await call(h.routes, SUB, { url: SUB })).status, 400)
  eq('POST bad JSON → 400', (await call(h.routes, SUB, { method: 'POST', url: U, body: '{oops' })).status, 400)
  eq('POST missing model → 400', (await call(h.routes, SUB, { method: 'POST', url: U, body: JSON.stringify({ provider: 'p' }) })).status, 400)
  const posted = await call(h.routes, SUB, { method: 'POST', url: U, body: JSON.stringify({ provider: 'deepseek', model: 'm', reasoningEffort: 'high' }) })
  eq('POST → 200', posted.status, 200)
  eq('GET after POST → route', (await call(h.routes, SUB, { url: U })).json?.route?.model, 'm')
  eq('PUT → 405', (await call(h.routes, SUB, { method: 'PUT', url: U })).status, 405)
  eq('DELETE → 200', (await call(h.routes, SUB, { method: 'DELETE', url: U })).status, 200)
  eq('GET after DELETE → null', (await call(h.routes, SUB, { url: U })).json?.route, null)
}

// ── Group 5: agent/request waterfall override + session cleanup ──
{
  const h = await freshHost()
  const SUB = '/api/model-picker/subagent'
  const sid = 'sess-wf'
  const U = SUB + '?sessionId=' + sid
  await call(h.routes, SUB, { method: 'POST', url: U, body: JSON.stringify({ provider: 'deepseek', model: 'chosen', reasoningEffort: 'high' }) })
  const wf = h.dispatch['agent/request'][0]
  ok('waterfall handler registered', typeof wf === 'function')

  // depth 0 → passthrough (no override)
  let seen, called
  const next0 = (arg) => { seen = arg ?? null }
  wf({ agent: { options: { subagentDepth: 0 }, session: { id: sid } } }, next0)
  eq('depth 0 passes through untouched', seen, null)

  // depth >= 1 with no route for a different session → passthrough
  seen = undefined; called = false
  wf({ agent: { options: { subagentDepth: 2 }, session: { id: 'other' } }, provider: 'orig', model: 'orig' }, (arg) => { called = true; seen = arg })
  ok('no route → passthrough (next() with no override)', called && seen === undefined)

  // depth >= 1 with a route → override provider/model/effort
  seen = undefined
  wf({ agent: { options: { subagentDepth: 1 }, session: { id: sid } }, provider: 'orig', model: 'orig' }, (arg) => { seen = arg })
  eq('override provider', seen?.provider, 'deepseek')
  eq('override model', seen?.model, 'chosen')
  eq('override effort', seen?.reasoningEffort, 'high')

  // session disposed → route removed → passthrough again
  h.ons['session/disposed'].forEach((fn) => fn({ id: sid }))
  seen = undefined; called = false
  wf({ agent: { options: { subagentDepth: 1 }, session: { id: sid } }, provider: 'orig', model: 'orig' }, (arg) => { called = true; seen = arg })
  ok('after dispose → passthrough (next() with no override)', called && seen === undefined)
}

// ── Group 6: unload collects disposers, no zombie route ──
{
  const h = await freshHost()
  ok('routes registered', h.routes.has('/api/model-picker/models') && h.routes.has('/api/model-picker/subagent'))
  h.disposers.forEach((d) => d())
  ok('after unload, routes removed (no zombie)', !h.routes.has('/api/model-picker/models') && !h.routes.has('/api/model-picker/subagent'))
}

// ── Group 7: model-info resolution across service shapes ──
// The Host LlmRuntime exposes resolveModelInfo and NOT resolveModel (that
// method lives on adapters). The old code called resolveModel unconditionally,
// every call threw, the per-model catch swallowed it, and rows came back with
// no contextWindow at all — the badge was dead and nothing failed loudly. These
// cover the shapes this has to survive.
const ROWS = '/api/model-picker/models'
const ctxRows = (r) => (r.json?.rows ?? []).filter((row) => row.contextWindow !== undefined).length
const totalRows = (r) => (r.json?.rows ?? []).length

{
  // The real Host shape: resolveModelInfo only.
  const h = await freshHost({ resolver: 'infoOnly' })
  const warm = await waitWarm(h.routes, ROWS)
  ok('infoOnly: warms to 200', !!warm)
  ok('infoOnly: resolveModelInfo is used', h.calls.resolveModelInfo > 0, `resolveModelInfo=${h.calls.resolveModelInfo}`)
  eq('infoOnly: resolveModel never called', h.calls.resolveModel, 0)
  ok('infoOnly: rows carry contextWindow', ctxRows(warm) > 0, `${ctxRows(warm)} / ${totalRows(warm)}`)
  eq('infoOnly: every resolvable row has contextWindow', ctxRows(warm), totalRows(warm))
}

{
  // An older service that only knows resolveModel still works.
  const h = await freshHost({ resolver: 'modelOnly' })
  const warm = await waitWarm(h.routes, ROWS)
  ok('modelOnly: warms to 200', !!warm)
  ok('modelOnly: resolveModel is used', h.calls.resolveModel > 0, `resolveModel=${h.calls.resolveModel}`)
  eq('modelOnly: resolveModelInfo never called', h.calls.resolveModelInfo, 0)
  ok('modelOnly: rows carry contextWindow', ctxRows(warm) > 0, `${ctxRows(warm)} / ${totalRows(warm)}`)
}

{
  // A service exposing both must be read through resolveModelInfo — the same
  // window the Host publishes, not the adapter's narrower one.
  const h = await freshHost({ resolver: 'both' })
  const warm = await waitWarm(h.routes, ROWS)
  ok('both: warms to 200', !!warm)
  ok('both: resolveModelInfo preferred', h.calls.resolveModelInfo > 0 && h.calls.resolveModel === 0,
    `info=${h.calls.resolveModelInfo} model=${h.calls.resolveModel}`)
  const flash = (warm?.json?.rows ?? []).find((row) => row.id === 'deepseek-v4-flash')
  eq('both: the wider contextWindow wins', flash?.contextWindow, 128000)
}

{
  // Neither method present: no throw, rows still built from listModels, and the
  // dim de-dup set stays populated (it feeds discovery, so it must not go empty
  // just because metadata resolution is unavailable).
  const h = await freshHost({ resolver: 'none' })
  const warm = await waitWarm(h.routes, ROWS)
  ok('neither: still warms to 200 (no throw)', !!warm)
  eq('neither: resolveModel not called', h.calls.resolveModel, 0)
  eq('neither: resolveModelInfo not called', h.calls.resolveModelInfo, 0)
  ok('neither: rows still built from listModels', totalRows(warm) > 0, `rows=${totalRows(warm)}`)
  ok('neither: provider mappings still produced', (warm?.json?.providers ?? []).length > 0)
}

// ── Group 8: no temp files left behind by the dim bridge ──
// The old path mkdtemp'd a directory and redirected the child's stdout into it,
// which stranded a ~10MB copy (apiKey previews included) whenever the host was
// killed before the callback ran its finally. The pipe path must not create
// anything under tmpdir() at all.
{
  const { readdirSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const before = readdirSync(tmpdir()).filter((n) => n.startsWith('dsh-models-dim-')).length
  const h = await freshHost()
  await waitWarm(h.routes, ROWS)
  const after = readdirSync(tmpdir()).filter((n) => n.startsWith('dsh-models-dim-')).length
  eq('collect leaves no dsh-models-dim-* directory in tmpdir', after, before)
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1) }
