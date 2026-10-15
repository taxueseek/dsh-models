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
import { homedir, tmpdir } from 'node:os'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

export const name = 'dsh-models'

export const inject = ['llm', 'webServer', 'sessions']

const CACHE_MS = 30_000
const DIM_REFRESH_MS = 60_000
const DIM_BACKOFF_MS = 5 * 60_000
const DISCOVERED_CAP = 30
const DIM_TIMEOUT_MS = 20_000
const COLLECT_TIMEOUT_MS = 30_000

const ROUTE = '/api/model-picker/models'
const SUBAGENT_ROUTE = '/api/model-picker/subagent'

let cache = { at: 0, value: null }
let cacheRefreshing = null
let dim = { at: 0, value: null }
let dimRefreshing = null
let dimFailedAt = 0

// ─── Subagent model routing ───
// Per-session subagent model override: sessionId -> { provider, model, reasoningEffort? }
const subagentRoutes = new Map()

function dimCandidates() {
  return ['dim', homedir() + '/.local/bin/dim']
}

function runDim(args) {
  const attempt = (bin) => new Promise((resolve, reject) => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-models-dim-'))
    const file = join(dir, 'out.json')
    const fd = openSync(file, 'w')
    const script = 'exec "$1" ' + args.map((_, i) => '"$' + (i + 2) + '"').join(' ') + ' > "$' + (args.length + 2) + '" 2>/dev/null'
    execFile('/bin/sh', ['-c', script, 'sh', bin, ...args, file], { timeout: DIM_TIMEOUT_MS }, (error) => {
      closeSync(fd)
      try {
        if (error !== null && error !== undefined) { reject(error); return }
        resolve(JSON.parse(readFileSync(file, 'utf8')))
      } catch (readError) {
        reject(readError)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })
  return (async () => {
    let last
    for (const bin of dimCandidates()) {
      try { return await attempt(bin) } catch (error) { last = error }
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
      } catch {
        dimFailedAt = Date.now()
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
  const providerResults = await Promise.all(allProviders.map(async (provider) => {
    let listed
    try {
      listed = await llm.listModels(provider.id)
    } catch {
      return null
    }
    const ids = new Set()
    const models = listed ?? []
    const infos = await Promise.all(models.map(async (model) => {
      ids.add(model.id)
      try {
        return await llm.resolveModel(provider.id, model.id)
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
  return { rows, discovered, providers: mappings }
}

function sendJson(res, status, body) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

export function apply(ctx) {
  // ─── Model facts API (same as dsh-model-picker) ───
  ctx.webServer.register({
    kind: 'exact',
    path: ROUTE,
    handler: (_req, res) => {
      void (async () => {
        try {
          const now = Date.now()
          if (cache.value === null || now - cache.at > CACHE_MS) {
            if (cacheRefreshing === null) {
              const timeout = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('collect timed out')), COLLECT_TIMEOUT_MS)
              })
              timeout.catch(() => { })
              cacheRefreshing = Promise.race([collect(ctx.llm), timeout])
                .then((value) => { cache = { at: Date.now(), value } })
                .catch(() => { })
                .finally(() => { cacheRefreshing = null })
            }
            if (cache.value === null) {
              try { await cacheRefreshing } catch { }
              if (cache.value === null) {
                sendJson(res, 503, { ok: false, error: 'model facts unavailable' })
                return
              }
            }
          }
          sendJson(res, 200, { ok: true, ...cache.value })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
        }
      })()
    },
  })

  // ─── Subagent model routing API ───
  ctx.webServer.register({
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

  // ─── Subagent model routing waterfall ───
  // Register an `agent/request` listener that overrides the model for subagents
  // when the user has configured a subagent model for the session.
  ctx.inject(['sessions'], (scope) => {
    const sessions = scope.sessions
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
    })
  })
}
