// Host half of dsh-models.
//
// A renamed, maintained fork of ttmouse/dsh-model-picker (v1.18.0 baseline)
// with:
// 1. Subagent model routing — per-session subagent model override
// 2. Custom background color — user-configurable picker background
// 3. dim bridge — model facts (price/maxOut/released) + new-model discovery
// 4. Settings-page card — discovery list, ignore/restore, hidden-model management
//
// HTTP routes (/api/model-picker/…) and localStorage keys (dsh.modelPicker.*)
// intentionally keep their upstream names so existing user preferences
// (favorites, hidden models, subagent routes) carry over seamlessly.
//
// The subagent routing works by registering an `agent/request` waterfall
// listener that overrides the model for any subagent (depth >= 1) when
// the user has configured a subagent model for the session.

import { execFile } from 'node:child_process'
import { homedir } from 'node:os'

export const name = 'dsh-models'

// `llm` is deliberately NOT in the module-level inject: it is a remote
// service (Typert) whose availability can flap when the host peer
// reconnects. A module-level inject would take the whole plugin — including
// the llm-free subagent routing — down with it, and a route handler that
// reads `ctx.llm` after the fiber unloads throws "inactive context" on every
// request. The models route instead rides a nested inject fiber below, so it
// exists only while `llm` is available and re-registers when it returns.
export const inject = ['webServer', 'sessions']

const CACHE_MS = 60_000
const COLLECT_BACKOFF_MS = 30_000
// dim's catalog is a model database that turns over on the scale of days, not
// minutes — a model that appears in dim's list today is still "new" tomorrow.
// The 60s this used to be re-ran both dim subcommands (the `provider list` dump
// alone is ~10MB of JSON, ~1s of CPU) on every catalog refresh for freshness
// nobody could perceive. At 10 minutes the discovery feature still surfaces a
// new model within a coffee break, and the host stops paying ~1.5s of CPU every
// minute for a page that may not even be open.
const DIM_REFRESH_MS = 10 * 60_000
const DIM_BACKOFF_MS = 5 * 60_000
const DISCOVERED_CAP = 30
const DIM_TIMEOUT_MS = 20_000
const COLLECT_TIMEOUT_MS = 30_000
// `dim provider list --json` prints ~10MB for 147 providers, and Node's default
// execFile maxBuffer (1MB) kills it with ERR_CHILD_PROCESS_STDIO_MAXBUFFER.
// Raising the cap lets the child's stdout come back through the pipe directly:
// no temp file, no disk round trip, nothing left behind when the host is killed
// mid-collect (the old mkdtemp+redirect path stranded a full copy — apiKey
// previews included — in $TMPDIR on every unclean shutdown). 64MB leaves room
// for a catalog several times the current size.
const DIM_MAX_BUFFER = 64 * 1024 * 1024

const ROUTE = '/api/model-picker/models'
const SUBAGENT_ROUTE = '/api/model-picker/subagent'

let cache = { at: 0, value: null }
let cacheRefreshing = null
let cacheFailedAt = 0
let dim = { at: 0, value: null }
let dimRefreshing = null
let dimFailedAt = 0
/** The last dim failure's reason, or null while dim is healthy. Compared before
 *  logging so a persistently broken dim warns once, not on every refresh. */
let dimError = null

// ─── Subagent model routing ───
// Per-session subagent model override: sessionId -> { provider, model, reasoningEffort? }
const subagentRoutes = new Map()

function dimCandidates() {
  // The pinned path goes first. A bare `dim` would resolve through the host's
  // PATH, and this machine's PATH puts several third-party agent bin directories
  // ahead of ~/.local/bin — so a same-named `dim` dropped into any of them would
  // silently supply the catalog (prices, context windows, discoveries) instead.
  // The bare name stays as the fallback for an install the pinned path misses.
  return [homedir() + '/.local/bin/dim', 'dim']
}

/** Run one `dim` subcommand and parse its JSON stdout. */
function runDim(args) {
  const attempt = (bin) => new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: DIM_TIMEOUT_MS, maxBuffer: DIM_MAX_BUFFER }, (error, stdout) => {
      if (error !== null && error !== undefined) { reject(error); return }
      try {
        resolve(JSON.parse(stdout))
      } catch (parseError) {
        reject(parseError)
      }
    })
  })
  return (async () => {
    let last
    for (const bin of dimCandidates()) {
      try { return await attempt(bin) } catch (error) {
        last = error
        // ENOENT is what the fallback exists for; anything else is a property of
        // the invocation, not the binary, so the next candidate would repeat it.
        if (error?.code !== 'ENOENT') break
      }
    }
    throw last
  })()
}

async function dimCatalog() {
  const now = Date.now()
  if (dim.value !== null && now - dim.at < DIM_REFRESH_MS) return dim.value
  if (dimRefreshing === null && now - dimFailedAt >= DIM_BACKOFF_MS) {
    dimRefreshing = (async () => {
      try {
        const [models, providersRaw] = await Promise.all([
          runDim(['model', 'list', '--json']),
          runDim(['provider', 'list', '--json']),
        ])
        const byId = new Map()
        const byProvider = new Map()
        for (const model of Array.isArray(models) ? models : []) {
          if (typeof model?.id !== 'string' || model.id.length === 0) continue
          if (!byId.has(model.id)) byId.set(model.id, model)
          const bucket = byProvider.get(model.providerId)
          if (bucket === undefined) byProvider.set(model.providerId, [model])
          else bucket.push(model)
        }
        const providers = (Array.isArray(providersRaw) ? providersRaw : [])
          .filter((provider) => typeof provider?.id === 'string' && provider.id.length > 0)
          .map((provider) => ({ id: provider.id, name: provider.name ?? provider.id }))
        dim = { at: Date.now(), value: { byId, byProvider, providers } }
        dimFailedAt = 0
        dimError = null
      } catch (error) {
        dimFailedAt = Date.now()
        // Surface the reason once per failure window. Everything downstream of
        // this catches — a missing binary, a 20s timeout, the maxBuffer cap, a
        // shape change in dim's JSON — used to collapse into a silent
        // `dimFailedAt`, which is the same invisibility that let the
        // resolveModel bug live: prices, context windows and discoveries simply
        // stopped appearing with nothing anywhere to say why.
        const message = String(error?.code ?? error?.message ?? error)
        if (message !== dimError) {
          dimError = message
          console.warn('[dsh-models] dim catalog unavailable (' + message + '); price/context/discovery data will be missing until it recovers')
        }
      } finally {
        dimRefreshing = null
      }
    })()
  }
  if (dim.value === null) await dimRefreshing
  return dim.value
}

function dimPrice(model) {
  const pricing = model?.pricing
  return typeof pricing?.input === 'number' && typeof pricing?.output === 'number'
    ? { input: pricing.input, output: pricing.output }
    : undefined
}

function matchDimProvider(provider, ids, dim) {
  const lower = provider.id.toLowerCase()
  let best = null
  for (const dimProvider of dim.providers) {
    const dimLower = dimProvider.id.toLowerCase()
    const dimNameLower = dimProvider.name.toLowerCase()
    let score = 0
    if (dimLower === lower) score += 100
    else if (dimLower.includes(lower) || lower.includes(dimLower)) score += 20
    else if (dimNameLower.includes(lower) || lower.includes(dimNameLower)) score += 10
    let overlap = 0
    for (const model of dim.byProvider.get(dimProvider.id) ?? []) {
      if (ids.has(model.id)) overlap++
    }
    score += Math.min(overlap, 50)
    if (best === null || score > best.score) best = { provider: dimProvider, score, overlap }
  }
  if (best === null || (best.score < 100 && best.overlap < 3)) return null
  return best
}

async function collect(llm) {
  const catalog = await dimCatalog()
  const rows = []
  const catalogIds = new Map()
  const allProviders = llm.listProviders()
  // The Host `llm` service exposes resolveModelInfo, not resolveModel: the
  // latter exists only on adapters. Calling the wrong one threw for every
  // model, the surrounding catch swallowed it, and the context-window badge
  // silently rendered nothing (measured 0/252 rows carrying contextWindow).
  // Prefer resolveModelInfo; fall back to resolveModel so a host that ever
  // ships the other spelling (or a test double) still resolves.
  const resolveInfo = typeof llm.resolveModelInfo === 'function'
    ? (provider, id) => llm.resolveModelInfo(provider, id)
    : typeof llm.resolveModel === 'function'
      ? (provider, id) => llm.resolveModel(provider, id)
      : null
  const providerResults = await Promise.all(allProviders.map(async (provider) => {
    let listed
    try {
      listed = await llm.listModels(provider.id)
    } catch {
      return null
    }
    const ids = new Set()
    const models = listed ?? []
    // `ids` feeds the dim discovery de-dup below, so it must be filled on every
    // path — including the one where no resolver exists.
    const infos = await Promise.all(models.map(async (model) => {
      ids.add(model.id)
      if (resolveInfo === null) return undefined
      try {
        return await resolveInfo(provider.id, model.id)
      } catch {
        return undefined
      }
    }))
    return { provider, ids, models, infos }
  }))
  for (const result of providerResults) {
    if (result === null) continue
    const { provider, ids, models, infos } = result
    catalogIds.set(provider.id, ids)
    for (let index = 0; index < models.length; index++) {
      const model = models[index]
      const info = infos[index]
      const modalities = info?.inputModalities ?? model.inputModalities
      const contextWindow = info?.context?.contextWindow
      const meta = catalog?.byId.get(model.id)
      const price = dimPrice(meta)
      if (contextWindow === undefined && !Array.isArray(modalities) && price === undefined) continue
      rows.push({
        provider: provider.id,
        id: model.id,
        ...(typeof model.name === 'string' && model.name.length > 0 ? { name: model.name } : {}),
        ...(contextWindow === undefined ? {} : { contextWindow }),
        ...(Array.isArray(modalities) ? { input: [...modalities] } : {}),
        ...(price === undefined ? {} : { price }),
        ...(meta?.maxOutputTokens === undefined ? {} : { maxOut: meta.maxOutputTokens }),
        ...(meta?.raw?.release_date === undefined ? {} : { released: meta.raw.release_date }),
      })
    }
  }
  const discovered = []
  const mappings = []
  if (catalog !== null) {
    for (const provider of allProviders) {
      const ids = catalogIds.get(provider.id)
      if (ids === undefined) continue
      const match = matchDimProvider(provider, ids, catalog)
      mappings.push({
        provider: provider.id,
        dim: match?.provider.id ?? null,
        overlap: match?.overlap ?? 0,
        score: match?.score ?? 0,
      })
      if (match === null) continue
      const fresh = (catalog.byProvider.get(match.provider.id) ?? [])
        .filter((model) => typeof model?.id === 'string' && model.id.length > 0 && !ids.has(model.id))
        .sort((a, b) =>
          String(b.raw?.release_date ?? '').localeCompare(String(a.raw?.release_date ?? '')) ||
          String(a.name ?? a.id).localeCompare(String(b.name ?? b.id)))
        .slice(0, DISCOVERED_CAP)
      for (const model of fresh) {
        const name = typeof model.name === 'string' && model.name.length > 0 ? model.name : model.id
        const price = dimPrice(model)
        discovered.push({
          provider: provider.id,
          dimProvider: match.provider.name,
          id: model.id,
          name,
          ...(model.raw?.release_date === undefined ? {} : { released: model.raw.release_date }),
          ...(price === undefined ? {} : { price }),
          ...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }),
        })
      }
    }
  }
  // `dim` rides along so the browser half can tell "this build has no dim
  // bridge" (absent) apart from "the bridge is broken" (present with a reason).
  return { rows, discovered, providers: mappings, dim: dimError === null ? { ok: true } : { ok: false, error: dimError } }
}

function sendJson(res, status, body) {
  // Guard against a double response. When the client disconnects mid-request
  // res.end() can throw; a follow-up send from a catch block would then throw
  // again inside the fire-and-forget handler and surface as an unhandled
  // rejection. One check retires that whole class for both routes.
  if (res.writableEnded || res.headersSent) return
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

export function apply(ctx) {
  // ─── Model facts API (needs `llm`) ───
  // Rides a nested inject fiber: the route exists only while `llm` is
  // available, and the disposer is collected so an unload never leaves a
  // zombie route behind (a zombie throws "inactive context" on every request
  // once the fiber's store is cleared).
  ctx.inject(['llm'], (scoped) => {
    const llm = scoped.llm
    const disposer = ctx.webServer.register({
      kind: 'exact',
      path: ROUTE,
      handler: (_req, res) => {
        void (async () => {
          try {
            const now = Date.now()
            // Kick off a background refresh when the cache is stale or empty,
            // throttled and backed off so a cold or failing catalog never
            // spawns a fresh collect per request.
            if ((cache.value === null || now - cache.at > CACHE_MS)
                && cacheRefreshing === null && now - cacheFailedAt >= COLLECT_BACKOFF_MS) {
              let timer
              const timeout = new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('collect timed out')), COLLECT_TIMEOUT_MS)
              })
              timeout.catch(() => { })
              cacheRefreshing = Promise.race([collect(llm), timeout])
                .then((value) => { cache = { at: Date.now(), value }; cacheFailedAt = 0 })
                .catch(() => { cacheFailedAt = Date.now() })
                .finally(() => { clearTimeout(timer); cacheRefreshing = null })
            }
            // Never block the response on a full catalog build. A warm cache is
            // served immediately (stale-while-revalidate — the refresh above is
            // already in flight); only a cold cache answers 503, which the
            // browser half retries once the background refresh lands. The old
            // code awaited the collect here, so the first request after a
            // restart hung for up to COLLECT_TIMEOUT_MS (30s).
            if (cache.value === null) {
              sendJson(res, 503, { ok: false, error: 'model facts unavailable' })
              return
            }
            sendJson(res, 200, { ok: true, ...cache.value })
          } catch (error) {
            sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
          }
        })()
      },
    })
    return () => { disposer() }
  })

  // ─── Subagent model routing API (no `llm` needed) ───
  ctx.effect(() => {
    const disposer = ctx.webServer.register({
      kind: 'exact',
      path: SUBAGENT_ROUTE,
      handler: (req, res) => {
        void (async () => {
          try {
            const url = new URL(req.url, 'http://localhost')
            const sessionId = url.searchParams.get('sessionId')
            if (!sessionId) {
              sendJson(res, 400, { ok: false, error: 'sessionId required' })
              return
            }

            if (req.method === 'GET') {
              const route = subagentRoutes.get(sessionId) ?? null
              sendJson(res, 200, { ok: true, route })
              return
            }

            if (req.method === 'POST') {
              let body = ''
              for await (const chunk of req) body += chunk
              let parsed
              try { parsed = JSON.parse(body) } catch {
                sendJson(res, 400, { ok: false, error: 'invalid JSON' })
                return
              }
              const { provider, model, reasoningEffort } = parsed
              if (!provider || !model) {
                sendJson(res, 400, { ok: false, error: 'provider and model required' })
                return
              }
              subagentRoutes.set(sessionId, {
                provider,
                model,
                ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
              })
              sendJson(res, 200, { ok: true })
              return
            }

            if (req.method === 'DELETE') {
              subagentRoutes.delete(sessionId)
              sendJson(res, 200, { ok: true })
              return
            }

            sendJson(res, 405, { ok: false, error: 'method not allowed' })
          } catch (error) {
            sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
          }
        })()
      },
    })
    return () => { disposer() }
  }, 'dsh-models-subagent-route')

  // ─── Subagent model routing waterfall + session cleanup ───
  ctx.inject(['sessions'], (scope) => {
    const sessions = scope.sessions
    const disposers = [
      ctx.dispatch.on('agent/request', (event, next) => {
        const agent = event.agent
        // Only override subagents (depth >= 1)
        if (!agent.options || agent.options.subagentDepth < 1) return next()

        const sessionId = agent.session?.id
        if (!sessionId) return next()

        const route = subagentRoutes.get(sessionId)
        if (!route) return next()

        // Override the model for this subagent
        return next({
          ...event,
          provider: route.provider,
          model: route.model,
          ...(route.reasoningEffort !== undefined ? { reasoningEffort: route.reasoningEffort } : {}),
        })
      }),
      // Sessions that end must not leak their route entry forever.
      ctx.on('session/disposed', (session) => {
        const id = session?.id
        if (typeof id === 'string') subagentRoutes.delete(id)
      }),
    ]
    return () => { for (const dispose of disposers) dispose() }
  })
}
