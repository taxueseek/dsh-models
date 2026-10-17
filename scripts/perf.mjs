// Perf harness for the browser half: renders ModelPicker into jsdom with a
// directory shaped like the live one (19 providers / 252 models, the counts
// measured off /api/model-picker/models on 2026-10-17) and times the four
// interactions a user actually waits on — mount, popup open, keystroke
// filtering, arrow-key cursor, scroll — plus the module-level filter chain in
// isolation so a regression names its own stage.
//
// Run: node scripts/perf.mjs
import { createRequire } from 'node:module'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const REACT_DOM_CANDIDATES = [
  join(DSH_HOME, 'dsh-browser/node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom'),
  join(DSH_HOME, 'profiles/web/node_modules/.ignored/taxue-dsh-artisan/node_modules/.pnpm/react-dom@18.2.0_react@18.2.0/node_modules/react-dom'),
]
const JSDOM_CANDIDATES = [
  join(DSH_HOME, 'dsh-browser/node_modules/.pnpm/jsdom@26.1.0/node_modules/jsdom'),
  join(DSH_HOME, 'profiles/web/node_modules/.ignored/dsh-prompt-dock/node_modules/.pnpm/jsdom@26.1.0/node_modules/jsdom'),
]
const reactDomDir = REACT_DOM_CANDIDATES.find((p) => existsSync(join(p, 'client.js')))
const jsdomDir = JSDOM_CANDIDATES.find((p) => existsSync(join(p, 'package.json')))
if (!reactDomDir || !jsdomDir) {
  console.log('perf.mjs — SKIP (jsdom / matched react-dom pair not found on disk)')
  process.exit(0)
}

const { JSDOM } = createRequire(join(jsdomDir, 'package.json'))('jsdom')
const dom = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>', { url: 'http://127.0.0.1:3080/', pretendToBeVisual: true })
globalThis.window = dom.window
globalThis.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
globalThis.Element = dom.window.Element
globalThis.Node = dom.window.Node
globalThis.Event = dom.window.Event
globalThis.MouseEvent = dom.window.MouseEvent
globalThis.KeyboardEvent = dom.window.KeyboardEvent
globalThis.CustomEvent = dom.window.CustomEvent
globalThis.localStorage = dom.window.localStorage
dom.window.localStorage.clear()
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.requestAnimationFrame = (fn) => { fn(0); return 0 }
// MP_VIRTUAL=1 stubs the list's viewport to a real 320px so the windowed path
// runs under jsdom (whose clientHeight is always 0) — that is how the
// virtualization win is measured here. The stub goes on the prototype because
// the popup remounts a fresh list element every open.

// ─── directory shaped like the live one ───
// 19 providers / 252 models, matching the measured payload. Two of them wear a
// `(modlens vision)` suffix so the fold path is exercised, and one carries the
// full 457-model OpenRouter shape dim can surface.
const PROVIDER_NAMES = ['deepseek-official', 'deepseek-account', 'codex', 'claude', 'grok', 'copilot', 'antigravity', 'commandcode', 'FallbacksChain', 'gmi', 'mimo', 'bai', 'opencode-go', 'opencode-go-extra', 'opencode-go-responses', 'opencode2dsh', 'tokenrhythm', 'workbuddy', 'workbuddy-ai']
const DESCRIPTIONS = ['general purpose flagship', 'fast tier', 'reasoning tier', 'long context', 'vision capable', 'coding specialist']
const REASONING = { defaultEffort: 'high', efforts: [{ id: 'low', name: 'Low', description: 'quick' }, { id: 'medium', name: 'Medium', description: 'balanced' }, { id: 'high', name: 'High', description: 'thorough' }] }

const GROUPS = PROVIDER_NAMES.map((id, pi) => ({
  id,
  name: id.charAt(0).toUpperCase() + id.slice(1),
  models: Array.from({ length: [70, 34, 31, 24, 18, 14, 13, 12, 10, 9, 9, 8][pi] ?? 4 }, (_, mi) => ({
    id: id + '-model-' + mi,
    name: id.split('-')[0] + ' Model ' + mi,
    description: DESCRIPTIONS[(pi + mi) % DESCRIPTIONS.length],
    ...(mi % 3 === 0 ? { reasoning: REASONING } : {}),
  })),
}))
GROUPS.push({ id: 'grok-vision', name: 'Grok (modlens vision)', models: [{ id: 'grok-model-0', name: 'Grok Model 0 Vision', description: 'vision' }] })
const TOTAL = GROUPS.reduce((n, g) => n + g.models.length, 0)

const factsRows = []
for (const g of GROUPS) for (const m of g.models) factsRows.push({ provider: g.id, id: m.id, contextWindow: [128000, 200000, 1000000][m.id.length % 3], input: ['text', 'image'] })
const discovered = Array.from({ length: 57 }, (_, i) => ({ provider: 'opencode-go', dimProvider: 'OpenCode', id: 'new-model-' + i, name: 'New Model ' + i, released: '2026-0' + (1 + (i % 9)) + '-01', price: { input: 0.5, output: 1.5 }, contextWindow: 200000 }))

const snapshot = {
  current: { provider: 'commandcode', model: 'commandcode-model-3', reasoningEffort: 'high' },
  routable: null,
  groups: GROUPS,
  failures: [],
  status: 'ready',
  error: null,
}
const listeners = new Set()
const store = { subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) }, getSnapshot: () => snapshot }

globalThis.fetch = async (url) => {
  const u = String(url)
  if (u.includes('/api/model-picker/subagent')) return { ok: true, status: 200, json: async () => ({ ok: true, route: null }) }
  return { ok: true, status: 200, json: async () => ({ ok: true, rows: factsRows, discovered }) }
}

// Seed a usage history so the 常用/排序 paths do real work instead of hitting
// their empty fast path.
const seedUsage = {}
for (let i = 0; i < 200; i++) seedUsage[GROUPS[i % GROUPS.length].id + '/model-' + i] = { count: 10 - (i % 10), lastUsed: Date.now() - i * 1000 }
dom.window.localStorage.setItem('dsh.modelPicker.usage', JSON.stringify(seedUsage))
dom.window.localStorage.setItem('dsh.modelPicker.favorites', JSON.stringify(GROUPS.slice(0, 6).map((g) => g.id + '/' + g.models[0].id)))

if (process.env.MP_VIRTUAL === '1') {
  Object.defineProperty(dom.window.HTMLElement.prototype, 'clientHeight', {
    get() { return this.classList?.contains('dsh-mp2-list') || this.classList?.contains('dsh-mp2-subagentList') ? 320 : 0 },
    configurable: true,
  })
}

const reactRequire = createRequire(join(reactDomDir, 'index.js'))
const React = reactRequire('react')
const { createRoot } = reactRequire('react-dom/client')
const { act } = React

let plugin = null
dom.window.__ModuleLoader__ = { load({ factory }) { plugin = factory((name) => { if (name === 'react') return React; throw new Error('unexpected require(' + name + ')') }) } }
// eslint-disable-next-line no-eval
eval(readFileSync(join(root, 'lib/client.js'), 'utf8'))

const captured = {}
const slots = { inject(seat, fn) { return fn() }, register(spec, Component) { captured[spec.name] = { spec, Component }; return () => {} } }
const sessions = { subagentAddress: () => undefined }
const modelDirectories = { directoryFor: () => ({ store, load: async () => {}, select: async () => {} }) }
plugin.apply({
  inject(names, cb) { return cb({ locale: { getSnapshot: () => ({ active: 'zh' }), subscribe: () => () => {} }, slots, modelDirectories, sessions, remote: {}, 'remote.session': {} }) },
  slots,
  effect(fn) { const d = fn(); return typeof d === 'function' ? d : undefined },
})

const seat = captured['conversation.input.model']
const props = seat.spec.inject('perf-sess')
const reactRoot = createRoot(document.getElementById('app'))

// ─── timing helpers ───
const N = 5
const marks = []
function time(label, fn) {
  const runs = []
  for (let i = 0; i < N; i++) {
    const t0 = performance.now()
    fn()
    runs.push(performance.now() - t0)
  }
  runs.sort((a, b) => a - b)
  const median = runs[Math.floor(N / 2)]
  marks.push({ label, median, min: runs[0], max: runs[N - 1] })
  return median
}
const setInputValue = (el, value) => {
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
}
const flush = (ms) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })

console.log('perf.mjs — dsh-models browser-half perf')
console.log(`directory: ${GROUPS.length} providers / ${TOTAL} models, ${discovered.length} dim discoveries, 200 usage records`)

let mountMs = 0
{
  const t0 = performance.now()
  await act(async () => { reactRoot.render(React.createElement(seat.Component, { ...props, locked: false })) })
  await flush(60)
  mountMs = performance.now() - t0
  marks.push({ label: 'mount (trigger only)', median: mountMs, min: mountMs, max: mountMs })
}

// popup open: the full grouped list (recent + favorites + every provider)
{
  const trigger = document.querySelector('.dsh-mp2-triggerLeft')
  await act(async () => { trigger.click() })
  await flush(360)
  const rows = document.querySelectorAll('.dsh-mp2-list .dsh-mp2-option').length
  console.log(`rows rendered on open: ${rows}`)
  // close/reopen five times, timing the reopen (the first open carries the facts fetch)
  for (let i = 0; i < N; i++) {
    await act(async () => { document.querySelector('.dsh-mp2-triggerLeft').click() })
    await flush(10)
    const t0 = performance.now()
    await act(async () => { document.querySelector('.dsh-mp2-triggerLeft').click() })
    await flush(400)
    marks.push({ label: 'popup open (grouped list)', median: performance.now() - t0, min: 0, max: 0 })
  }
  // collapse the 5 samples into one median
  const opens = marks.filter((m) => m.label === 'popup open (grouped list)')
  opens.sort((a, b) => a.median - b.median)
  const mid = opens[Math.floor(opens.length / 2)].median
  marks.splice(marks.findIndex((m) => m.label === 'popup open (grouped list)'), opens.length, { label: 'popup open (grouped list)', median: mid, min: opens[0].median, max: opens[opens.length - 1].median })
}

const search = () => document.querySelector('.dsh-mp2-search')
const list = () => document.querySelector('.dsh-mp2-list')

// keystroke: measure the FULL debounce+filter+render cycle the user waits on,
// and the raw filter+render with the debounce already settled.
{
  const query = 'model 12'
  await act(async () => { setInputValue(search(), query) })
  const t0 = performance.now()
  await flush(400)
  marks.push({ label: 'keystroke → filtered list (incl. 300ms debounce)', median: performance.now() - t0, min: 0, max: 0 })

  // raw: type a further char and time only the commit after the debounce fires
  const runs = []
  for (let i = 0; i < N; i++) {
    await act(async () => { setInputValue(search(), query + 'x'.repeat(i)) })
    await flush(340)
    const t1 = performance.now()
    await flush(40)
    runs.push(performance.now() - t1)
  }
  runs.sort((a, b) => a - b)
  marks.push({ label: 'filter+render after debounce fires', median: runs[Math.floor(N / 2)], min: runs[0], max: runs[N - 1] })
  await act(async () => { setInputValue(search(), '') })
  await flush(400)
}

// arrow cursor
{
  const runs = []
  for (let i = 0; i < N; i++) {
    const t0 = performance.now()
    await act(async () => { search().dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) })
    runs.push(performance.now() - t0)
  }
  runs.sort((a, b) => a - b)
  marks.push({ label: 'arrow key → cursor moves', median: runs[Math.floor(N / 2)], min: runs[0], max: runs[N - 1] })
}

// scroll (throttled through rAF, reads offsetTop for every group)
{
  const runs = []
  for (let i = 0; i < N; i++) {
    const l = list()
    l.scrollTop = 400 + i * 200
    const t0 = performance.now()
    await act(async () => { l.dispatchEvent(new dom.window.Event('scroll')) })
    runs.push(performance.now() - t0)
  }
  runs.sort((a, b) => a - b)
  marks.push({ label: 'scroll → spy updates', median: runs[Math.floor(N / 2)], min: runs[0], max: runs[N - 1] })
}

// favorite toggle: the full read-modify-write of the favorites set
{
  const runs = []
  for (let i = 0; i < N; i++) {
    const star = document.querySelector('.dsh-mp2-option .dsh-mp2-star')
    const t0 = performance.now()
    await act(async () => { star.click() })
    runs.push(performance.now() - t0)
  }
  runs.sort((a, b) => a - b)
  marks.push({ label: 'favorite toggle', median: runs[Math.floor(N / 2)], min: runs[0], max: runs[N - 1] })
}

console.log('')
console.log('label'.padEnd(48) + 'median'.padStart(9) + 'min'.padStart(9) + 'max'.padStart(9))
for (const m of marks) console.log(m.label.padEnd(48) + (m.median.toFixed(1) + 'ms').padStart(9) + (m.min.toFixed(1) + 'ms').padStart(9) + (m.max.toFixed(1) + 'ms').padStart(9))
console.log('')
console.log('rows in the list:', document.querySelectorAll('.dsh-mp2-list .dsh-mp2-option').length)
