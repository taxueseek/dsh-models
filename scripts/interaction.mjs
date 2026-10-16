// Interaction test for the browser half of dsh-models.
//
// Renders the registered ModelPicker into jsdom with a matched react-dom 18
// pair, then drives it the way a user does — open the popup, search, favorite,
// arrow-navigate, scroll the list, open the effort picker — and asserts the
// render + interaction hold. Two regressions this specifically guards:
//   • onListScroll read event.currentTarget inside a rAF callback (nulled by
//     React) and threw on every scroll → the rAF stub records any throw.
//   • chooseSubagent called the useState setter that shadowed the module
//     saveSubagentRoute → asserted as a source invariant.
//
// The host half is covered by scripts/host-route.mjs (pure Node, always runs).
// This one needs jsdom + a matched react/react-dom pair from the harness; if
// they are not on disk it SKIPS (exit 0) so `npm test` stays green elsewhere.
//
// Run: node scripts/interaction.mjs
import { createRequire } from 'node:module'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

// ─── locate harness deps (react-dom 18 + react 18 matched pair, and jsdom) ───
// dsh keeps its profile/harness packages under $DSH_HOME (default ~/.dsh); the
// react-dom pair and jsdom live in pnpm's content-addressed store there. Paths
// are built from homedir()/DSH_HOME so no machine-specific path is committed.
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
  console.log('interaction.mjs — SKIP (jsdom / matched react-dom pair not found on disk)')
  console.log('  react-dom:', reactDomDir ?? 'missing', '| jsdom:', jsdomDir ?? 'missing')
  process.exit(0)
}

let pass = 0, fail = 0
const failures = []
function ok(name, cond, extra = '') { if (cond) pass++; else { fail++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')) } }
function eq(name, got, want) { ok(name, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`) }
const flush = (ms) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
// React installs a value tracker on inputs; assigning .value directly is
// deduped away and onChange never fires, so drive it through the native setter.
function setInputValue(el, value) {
  const proto = el.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
  el.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
}

// ─── jsdom + browser globals ───
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
// rAF stub that records a throw from its callback: the scroll-spy regression
// lived exactly there (reading a nulled event.currentTarget).
globalThis.__raf = { calls: 0, error: null }
globalThis.requestAnimationFrame = (fn) => { globalThis.__raf.calls++; try { fn(0) } catch (e) { globalThis.__raf.error = e } return 0 }

// The two host routes the picker fetches on mount, stubbed to the shapes the
// host returns (facts ok so the 503-retry path is not exercised here).
globalThis.fetch = async (url) => {
  const u = String(url)
  if (u.includes('/api/model-picker/subagent')) return { ok: true, status: 200, json: async () => ({ ok: true, route: null }) }
  return { ok: true, status: 200, json: async () => ({ ok: true, rows: [
    { provider: 'deepseek', id: 'deepseek-chat', contextWindow: 128000, input: ['text'] },
    { provider: 'zhipu', id: 'glm-4.6', contextWindow: 200000, input: ['text'] },
  ], discovered: [] }) }
}

// ─── matched react / react-dom pair ───
const reactRequire = createRequire(join(reactDomDir, 'index.js'))
const React = reactRequire('react')
const { createRoot } = reactRequire('react-dom/client')
const { act } = React

// ─── load the plugin through its loader entry ───
let plugin = null
dom.window.__ModuleLoader__ = {
  load({ factory }) {
    const module = { exports: {} }
    const result = factory((name) => { if (name === 'react') return React; throw new Error('unexpected require(' + name + ')') })
    plugin = result === undefined ? module.exports : result
  },
}
// eslint-disable-next-line no-eval
eval(readFileSync(join(root, 'lib/client.js'), 'utf8'))
if (!plugin || typeof plugin.apply !== 'function') { console.log('interaction.mjs — FAIL: plugin did not load'); process.exit(1) }

// ─── fake slot service + model directory store ───
const GROUPS = [
  { id: 'deepseek', name: 'DeepSeek', models: [
    { id: 'deepseek-chat', name: 'DeepSeek Chat', description: 'general' },
    { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', description: 'thinking',
      reasoning: { defaultEffort: 'high', efforts: [{ id: 'low', name: 'Low', description: 'low' }, { id: 'high', name: 'High', description: 'high' }] } },
  ] },
  { id: 'zhipu', name: '智谱GLM', models: [ { id: 'glm-4.6', name: 'GLM-4.6', description: 'flagship' } ] },
  { id: 'deepseek-vision', name: 'DeepSeek (modlens vision)', models: [ { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner Vision', description: 'vision' } ] },
]
let snapshot = { current: { provider: 'deepseek', model: 'deepseek-reasoner', reasoningEffort: 'high' }, routable: null, groups: GROUPS, failures: [], status: 'ready', error: null }
const listeners = new Set()
const store = { subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) }, getSnapshot: () => snapshot }

const captured = {}
const slots = {
  inject(seat, fn) { return fn() },
  register(spec, Component) { captured[spec.name] = { spec, Component }; return () => { delete captured[spec.name] } },
}
const sessions = { subagentAddress: () => undefined }
const modelDirectories = { directoryFor: () => ({ store, load: async () => {}, select: async () => {} }) }
const fakeLocale = { getSnapshot: () => ({ active: 'en' }), subscribe: () => () => {} }
const ctx = {
  inject(names, cb) { const d = cb({ locale: fakeLocale, slots, modelDirectories, sessions, remote: {}, 'remote.session': {} }); return typeof d === 'function' ? d : undefined },
  slots,
  effect(fn) { const d = fn(); return typeof d === 'function' ? d : undefined },
}
plugin.apply(ctx)

const seat = captured['conversation.input.model']
ok('registered into conversation.input.model', !!seat && typeof seat.Component === 'function')
if (!seat) { console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0) }

const props = seat.spec.inject('sess-test') // { available, sessionId, directory, load, select }
const reactRoot = createRoot(document.getElementById('app'))
await act(async () => { reactRoot.render(React.createElement(seat.Component, { ...props, locked: false })) })
await flush(60)

console.log('interaction.mjs — dsh-models browser-half tests')

// ── mount + trigger ──
ok('trigger mounted', !!document.querySelector('.dsh-mp2-triggerLeft'))
ok('stylesheet injected', !!document.getElementById('dsh-models-style'))

// ── open the model picker ──
await act(async () => { document.querySelector('.dsh-mp2-triggerLeft').click() })
await flush(360)
const rowsOpen = document.querySelectorAll('.dsh-mp2-list .dsh-mp2-option').length
ok('model popup opens with rows', rowsOpen > 0, 'rows=' + rowsOpen)

// ── search narrows ──
await act(async () => { setInputValue(document.querySelector('.dsh-mp2-search'), 'glm') })
await flush(400)
const rowsSearch = document.querySelectorAll('.dsh-mp2-list .dsh-mp2-option').length
ok('search "glm" narrows to the GLM row', rowsSearch === 1, 'rows=' + rowsSearch)
await act(async () => { setInputValue(document.querySelector('.dsh-mp2-search'), '') })
await flush(400)

// ── favorite toggle ──
await act(async () => { const star = document.querySelector('.dsh-mp2-option .dsh-mp2-star'); if (star) star.click() })
await flush(50)
ok('favorite toggle lights a star', document.querySelectorAll('.dsh-mp2-starOn').length >= 1)

// ── arrow navigation moves aria-activedescendant ──
const search = document.querySelector('.dsh-mp2-search')
const before = search.getAttribute('aria-activedescendant')
await act(async () => { search.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) })
await flush(30)
const after = search.getAttribute('aria-activedescendant')
ok('arrow key moves the cursor', before !== after, `${before} -> ${after}`)

// ── scroll: no throw in the rAF spy callback (guards the currentTarget bug) ──
const list = document.querySelector('.dsh-mp2-list')
globalThis.__raf.error = null
await act(async () => { list.scrollTop = 600; list.dispatchEvent(new dom.window.Event('scroll')) })
await flush(30)
ok('scroll ran the rAF callback', globalThis.__raf.calls > 0)
eq('scroll did not throw (currentTarget fix)', globalThis.__raf.error, null)

// ── effort picker renders via h(EffortPopup) with the current model's levels ──
await act(async () => { document.querySelector('.dsh-mp2-triggerRight').click() })
await flush(50)
const effortItems = document.querySelectorAll('.dsh-mp2-menuEffort [role="menuitemradio"]').length
ok('effort picker renders choices', effortItems >= 2, 'items=' + effortItems)

// ── source invariant: chooseSubagent must call the module fn, not the shadowed setter ──
const src = readFileSync(join(root, 'lib/client.js'), 'utf8')
ok('chooseSubagent calls saveSubagentRoute(sessionId, route)', /saveSubagentRoute\(sessionId, route\)/.test(src))
ok('no shadowed call "void setSubagentRoute(sessionId"', !/void\s+setSubagentRoute\(sessionId/.test(src))

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1) }
