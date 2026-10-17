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
// `subagentRoute` is mutable so a test can make the host answer with a route and
// watch what the picker does with it.
globalThis.__hostSubagentRoute = null
globalThis.__subagentPosts = []
globalThis.fetch = async (url, init) => {
  const u = String(url)
  if (u.includes('/api/model-picker/subagent')) {
    if (init?.method === 'POST') { globalThis.__subagentPosts.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ ok: true }) } }
    if (init?.method === 'DELETE') { globalThis.__subagentPosts.push(null); return { ok: true, status: 200, json: async () => ({ ok: true }) } }
    return { ok: true, status: 200, json: async () => ({ ok: true, route: globalThis.__hostSubagentRoute }) }
  }
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
// Per-session directories: the virtual-list test below mounts a second, large
// directory under its own session id without disturbing the small one.
const directories = new Map()
const modelDirectories = {
  directoryFor: (sid) => directories.get(sid) ?? { store, load: async () => {}, select: async () => {} },
}
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

// ── CSS regressions that shipped silently ──
// The fork lost three things the upstream CSS had. Each is invisible to a
// behavioural test but plain to the eye, so they are asserted against the
// stylesheet source.
ok('group header is sticky again (upstream had position:sticky)', /\.dsh-mp2-groupHeader\{position:sticky/.test(src))
ok('unselected rows collapse the check column', /\.dsh-mp2-option:not\(\.dsh-mp2-selected\)\s*\.dsh-mp2-check\{flex-basis:0;width:0\}/.test(src))
ok('dim tag uses the real --dsw- theme token', /\.dsh-mp2-dimtag\{[^}]*color:var\(--dsw-alias-brand-primary\)/.test(src))
ok('no stray --dsh-alias- token remains', !/--dsh-alias-/.test(src))

// ── the store subscription is not re-created per render ──
// Inline arrows here made React tear down and re-establish the subscription on
// every render (measured 56 subscribe / 55 unsubscribe pairs in a browser); the
// unsub/resub window can also drop a store notification.
ok('useSyncExternalStore args are memoized', /useSyncExternalStore\(subscribeDirectory, getDirectorySnapshot\)/.test(src))
ok('directory load runs off a ref, not a closure identity', /const loadRef = useRef\(load\)/.test(src))

// ── subagent route survives a host restart ──
// The host keeps routes in memory, so after a restart it answers null while
// localStorage still holds the user's pick. The picker must adopt the local copy
// and push it back; before this the stored route was written but never read.
{
  const sid = 'sess-restore'
  globalThis.__hostSubagentRoute = null
  globalThis.__subagentPosts.length = 0
  dom.window.localStorage.setItem('dsh.modelPicker.subagent.' + sid, JSON.stringify({ provider: 'zhipu', model: 'glm-4.6' }))
  // Mount into the document: a detached container is outside querySelector's reach.
  const restoreHost = document.createElement('div')
  document.body.appendChild(restoreHost)
  const restoreProps = seat.spec.inject(sid)
  const restoreRoot = createRoot(restoreHost)
  await act(async () => { restoreRoot.render(React.createElement(seat.Component, { ...restoreProps, locked: false })) })
  await flush(80)
  // The picker adopted the persisted route and pushed it back to the host.
  ok('restored route activates the subagent trigger', restoreHost.querySelector('.dsh-mp2-triggerSubActive') !== null)
  ok('restored route is pushed back to the host', globalThis.__subagentPosts.some((p) => p && p.provider === 'zhipu' && p.model === 'glm-4.6'),
    JSON.stringify(globalThis.__subagentPosts))
  await act(async () => { restoreRoot.unmount() })
  restoreHost.remove()

  // A route the host already knows wins, and is not overwritten by storage.
  globalThis.__hostSubagentRoute = { provider: 'deepseek', model: 'deepseek-chat' }
  globalThis.__subagentPosts.length = 0
  const hostHost = document.createElement('div')
  document.body.appendChild(hostHost)
  const hostProps = seat.spec.inject(sid)
  const hostRoot = createRoot(hostHost)
  await act(async () => { hostRoot.render(React.createElement(seat.Component, { ...hostProps, locked: false })) })
  await flush(80)
  ok('a host-known route is not rewritten from storage', globalThis.__subagentPosts.length === 0, JSON.stringify(globalThis.__subagentPosts))
  await act(async () => { hostRoot.unmount() })
  hostHost.remove()
}

// A stored route pointing at a provider/model the catalog no longer serves must
// NOT be pushed back: the host answers an unknown route with "no adapter
// registered for provider", so every subagent request would fail. It is dropped
// from storage instead.
{
  const sid = 'sess-dead-route'
  globalThis.__hostSubagentRoute = null
  globalThis.__subagentPosts.length = 0
  dom.window.localStorage.setItem('dsh.modelPicker.subagent.' + sid, JSON.stringify({ provider: 'provider-that-left', model: 'model-that-left' }))
  const deadHost = document.createElement('div')
  document.body.appendChild(deadHost)
  const deadProps = seat.spec.inject(sid)
  const deadRoot = createRoot(deadHost)
  await act(async () => { deadRoot.render(React.createElement(seat.Component, { ...deadProps, locked: false })) })
  await flush(120)
  ok('dead route is not pushed to the host', globalThis.__subagentPosts.length === 0, JSON.stringify(globalThis.__subagentPosts))
  eq('dead route is dropped from storage', dom.window.localStorage.getItem('dsh.modelPicker.subagent.' + sid), null)
  ok('dead route does not light the subagent trigger', deadHost.querySelector('.dsh-mp2-triggerSubActive') === null)
  await act(async () => { deadRoot.unmount() })
  deadHost.remove()
}

// A route the user explicitly cleared must stay cleared across a remount — the
// restore path must not treat "host says null" as "adopt whatever storage has"
// without checking that storage actually has something.
{
  const sid = 'sess-cleared'
  globalThis.__hostSubagentRoute = null
  globalThis.__subagentPosts.length = 0
  dom.window.localStorage.removeItem('dsh.modelPicker.subagent.' + sid)
  const clearHost = document.createElement('div')
  document.body.appendChild(clearHost)
  const clearProps = seat.spec.inject(sid)
  const clearRoot = createRoot(clearHost)
  await act(async () => { clearRoot.render(React.createElement(seat.Component, { ...clearProps, locked: false })) })
  await flush(120)
  ok('cleared route is not resurrected on remount', globalThis.__subagentPosts.length === 0, JSON.stringify(globalThis.__subagentPosts))
  ok('cleared route leaves the trigger inactive', clearHost.querySelector('.dsh-mp2-triggerSubActive') === null)
  await act(async () => { clearRoot.unmount() })
  clearHost.remove()
}

// ── IME composition must not filter mid-word ──
// Chinese/Japanese/Korean input fires onChange for every keystroke of an
// in-progress word. Filtering on those renders "no match" for text the user has
// not finished typing — the list visibly blanks mid-word. The filter has to wait
// for compositionend, while the input keeps showing what was typed.
{
  const imeHost = document.createElement('div')
  document.body.appendChild(imeHost)
  const imeRoot = createRoot(imeHost)
  await act(async () => { imeRoot.render(React.createElement(seat.Component, { ...seat.spec.inject('sess-ime'), locked: false })) })
  await flush(60)
  await act(async () => { imeHost.querySelector('.dsh-mp2-triggerLeft').click() })
  await flush(360)
  const rowsBefore = imeHost.querySelectorAll('.dsh-mp2-list .dsh-mp2-option').length
  ok('ime: popup opens with rows', rowsBefore > 0, 'rows=' + rowsBefore)

  const box = imeHost.querySelector('.dsh-mp2-search')
  const type = (v) => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(box, v)
    box.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  }
  await act(async () => {
    box.dispatchEvent(new dom.window.CompositionEvent('compositionstart', { bubbles: true }))
    type('z')
  })
  // Let every timer the filter could have queued fire.
  await flush(400)
  eq('ime: typing mid-composition does not filter', imeHost.querySelectorAll('.dsh-mp2-list .dsh-mp2-option').length, rowsBefore)
  eq('ime: the input still shows the in-progress text', box.value, 'z')

  await act(async () => {
    type('zzz-nonexistent')
    box.dispatchEvent(new dom.window.CompositionEvent('compositionend', { bubbles: true }))
  })
  await flush(120)
  const rowsAfter = imeHost.querySelectorAll('.dsh-mp2-list .dsh-mp2-option').length
  ok('ime: filtering resumes once the composition commits', rowsAfter !== rowsBefore, `rows ${rowsBefore} -> ${rowsAfter}`)

  await act(async () => { imeRoot.unmount() })
  imeHost.remove()
}

// ── virtualized list: the window must behave like the full list ──
// jsdom reports clientHeight 0, so the picker mounts everything — correct for
// the tests above but blind to the windowing path a browser takes. This mounts
// a large directory, stubs the list's viewport to a real 320px, and drives the
// paths virtualization changes: window size, spacer math, sticky headers, the
// scroll spy, cursor-follow and search over the windowed list.
{
  const VNAMES = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima', 'mike', 'november', 'oscar', 'papa', 'quebec', 'romeo', 'sierra', 'tango']
  const VCOUNTS = [70, 34, 31, 24, 18, 14, 13, 12, 10, 9, 9, 8, 7, 6, 5, 5, 4, 4, 3, 2]
  const VREASONING = { defaultEffort: 'high', efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] }
  const VGROUPS = VNAMES.map((id, pi) => ({
    id, name: 'V' + id,
    models: Array.from({ length: VCOUNTS[pi] }, (_, mi) => ({
      id: id + '-' + mi, name: 'V' + id + ' ' + mi,
      description: mi % 2 === 0 ? 'desc ' + mi : undefined,
      ...(mi % 3 === 0 ? { reasoning: VREASONING } : {}),
    })),
  }))
  const VTOTAL = VGROUPS.reduce((n, g) => n + g.models.length, 0)
  ok('virtual fixture is above the virtual threshold', VTOTAL > 200, 'models=' + VTOTAL)

  const vsnapshot = { current: null, routable: null, groups: VGROUPS, failures: [], status: 'ready', error: null }
  const vlisteners = new Set()
  const vstore = { subscribe(fn) { vlisteners.add(fn); return () => vlisteners.delete(fn) }, getSnapshot: () => vsnapshot }
  directories.set('sess-virtual', { store: vstore, load: async () => {}, select: async () => {} })

  const vHost = document.createElement('div')
  document.body.appendChild(vHost)
  const vRoot = createRoot(vHost)
  await act(async () => { vRoot.render(React.createElement(seat.Component, { ...seat.spec.inject('sess-virtual'), locked: false })) })
  await flush(60)
  await act(async () => { vHost.querySelector('.dsh-mp2-triggerLeft').click() })
  await flush(360)

  const vlist = vHost.querySelector('.dsh-mp2-list')
  ok('virtual: popup opened', vlist !== null)
  // A real viewport: 320px, well under the CSS clamp's 400px max.
  Object.defineProperty(vlist, 'clientHeight', { value: 320, configurable: true })
  // One scroll at the top publishes the measured viewport and settles the window.
  await act(async () => { vlist.scrollTop = 0; vlist.dispatchEvent(new dom.window.Event('scroll')) })
  await flush(60)

  const windowRows = () => vHost.querySelectorAll('.dsh-mp2-list .dsh-mp2-option').length
  const mounted = windowRows()
  ok('virtual: window mounts a small slice, not the full list', mounted > 0 && mounted < 60, 'mounted=' + mounted + ' of ' + VTOTAL)
  const spacerOf = (key) => {
    const el = vHost.querySelector('.dsh-mp2-list > [aria-hidden="true"]' + (key === 'top' ? ':first-child' : ':last-child'))
    return el === null ? 0 : Number(el.style.height.replace('px', ''))
  }
  ok('virtual: at the top the head spacer is empty', spacerOf('top') === 0, 'top=' + spacerOf('top'))

  // Deep in the list: the head spacer must stand in for the scrolled-away rows
  // (within one overscan + row height), the owning group's sticky header must
  // be mounted, and the elevator must light that group.
  await act(async () => { vlist.scrollTop = 3000; vlist.dispatchEvent(new dom.window.Event('scroll')) })
  await flush(80)
  const headSpacer = spacerOf('top')
  ok('virtual: head spacer tracks the scroll offset', headSpacer > 2700 && headSpacer < 2800, 'head=' + headSpacer)
  const headerNames = [...vHost.querySelectorAll('.dsh-mp2-list .dsh-mp2-groupHeader')].map((el) => el.textContent)
  ok('virtual: the owning group header is mounted while scrolled', headerNames.length > 0, 'headers=' + JSON.stringify(headerNames))
  const activeProvider = vHost.querySelector('.dsh-mp2-providerActive .dsh-mp2-providerName')
  ok('virtual: the elevator lights the group at the top edge',
    activeProvider !== null && headerNames.includes(activeProvider.textContent),
    'active=' + (activeProvider?.textContent ?? 'none') + ' headers=' + JSON.stringify(headerNames))
  ok('virtual: window stays small deep in the list', windowRows() > 0 && windowRows() < 60, 'mounted=' + windowRows())

  // The keyboard cursor drives the window: 30 arrow-downs from row 0 must mount
  // the row the cursor stands on, in the same commit.
  const vsearch = vHost.querySelector('.dsh-mp2-search')
  for (let i = 0; i < 30; i++) {
    await act(async () => { vsearch.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) })
  }
  await flush(50)
  const vActiveId = vsearch.getAttribute('aria-activedescendant')
  ok('virtual: the cursor row is mounted (window followed the arrows)',
    vActiveId !== null && vHost.querySelector('.dsh-mp2-list [id="' + vActiveId + '"]') !== null, 'activeId=' + vActiveId)

  // End jumps to the last row of the last group and mounts it.
  await act(async () => { vsearch.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'End', bubbles: true })) })
  await flush(80)
  const endActiveId = vsearch.getAttribute('aria-activedescendant')
  ok('virtual: End mounts the last row',
    endActiveId !== null && vHost.querySelector('.dsh-mp2-list [id="' + endActiveId + '"]') !== null, 'activeId=' + endActiveId)

  // Search over the windowed list still narrows and re-windows.
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
    setter.call(vsearch, 'valpha 3')
    vsearch.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  await flush(400)
  const searched = windowRows()
  // 'valpha 3' matches Valpha 3 and Valpha 30-39 — a deterministic 11.
  ok('virtual: search narrows the windowed list', searched === 11, 'rows=' + searched)
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
    setter.call(vsearch, '')
    vsearch.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  await flush(400)

  // The subagent popup windows the same full catalog.
  await act(async () => { vHost.querySelector('.dsh-mp2-triggerSub').click() })
  await flush(200)
  const subList = vHost.querySelector('.dsh-mp2-subagentList')
  Object.defineProperty(subList, 'clientHeight', { value: 240, configurable: true })
  await act(async () => { subList.scrollTop = 0; subList.dispatchEvent(new dom.window.Event('scroll')) })
  await flush(60)
  const subRows = subList.querySelectorAll('.dsh-mp2-option').length
  ok('virtual: subagent popup windows too', subRows > 0 && subRows < 60, 'mounted=' + subRows + ' of ' + VTOTAL)
  await act(async () => { document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  await flush(50)

  await act(async () => { vRoot.unmount() })
  vHost.remove()
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1) }
