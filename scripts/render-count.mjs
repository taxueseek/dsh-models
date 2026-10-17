// Render-count probe: quantifies how much React work each interaction causes,
// independent of jsdom's absolute speed. Counts store re-subscriptions, commit
// count and actual render duration via React.Profiler, and DOM rows.
//
// Run: node scripts/render-count.mjs
import { createRequire } from 'node:module'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const reactDomDir = [
  join(DSH_HOME, 'dsh-browser/node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom'),
  join(DSH_HOME, 'profiles/web/node_modules/.ignored/taxue-dsh-artisan/node_modules/.pnpm/react-dom@18.2.0_react@18.2.0/node_modules/react-dom'),
].find((p) => existsSync(join(p, 'client.js')))
const jsdomDir = [
  join(DSH_HOME, 'dsh-browser/node_modules/.pnpm/jsdom@26.1.0/node_modules/jsdom'),
  join(DSH_HOME, 'profiles/web/node_modules/.ignored/dsh-prompt-dock/node_modules/.pnpm/jsdom@26.1.0/node_modules/jsdom'),
].find((p) => existsSync(join(p, 'package.json')))
if (!reactDomDir || !jsdomDir) { console.log('SKIP: harness deps missing'); process.exit(0) }

const { JSDOM } = createRequire(join(jsdomDir, 'package.json'))('jsdom')
const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://127.0.0.1:3080/', pretendToBeVisual: true })
for (const k of ['window', 'document']) globalThis[k] = k === 'window' ? dom.window : dom.window.document
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
for (const k of ['Element', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'CustomEvent']) globalThis[k] = dom.window[k]
globalThis.localStorage = dom.window.localStorage
dom.window.localStorage.clear()
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.requestAnimationFrame = (fn) => { fn(0); return 0 }

const NAMES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's']
const REASONING = { defaultEffort: 'high', efforts: [{ id: 'low', name: 'Low', description: 'quick' }, { id: 'medium', name: 'Medium', description: 'balanced' }, { id: 'high', name: 'High', description: 'thorough' }] }
const GROUPS = NAMES.map((id, pi) => ({
  id, name: 'P' + id, models: Array.from({ length: [70, 34, 31, 24, 18, 14, 13, 12, 10, 9, 9, 8][pi] ?? 4 }, (_, mi) => ({ id: id + '-' + mi, name: 'M ' + id + mi, description: 'd' + mi, reasoning: REASONING })),
}))
const TOTAL = GROUPS.reduce((n, g) => n + g.models.length, 0)
const factsRows = GROUPS.flatMap((g) => g.models.map((m) => ({ provider: g.id, id: m.id, contextWindow: 128000, input: ['text'] })))
const snapshot = { current: { provider: 'd', model: 'd-3' }, routable: null, groups: GROUPS, failures: [], status: 'ready', error: null }

// Count how often React tears down and re-establishes the store subscription:
// useSyncExternalStore re-subscribes whenever its `subscribe` argument changes
// identity, and the picker passes a fresh arrow function on every render.
const subStats = { subscribeCalls: 0, unsubscribeCalls: 0 }
const listeners = new Set()
const store = {
  subscribe(fn) { subStats.subscribeCalls++; listeners.add(fn); return () => { subStats.unsubscribeCalls++; listeners.delete(fn) } },
  getSnapshot: () => snapshot,
}
globalThis.fetch = async (url) => String(url).includes('/subagent')
  ? { ok: true, status: 200, json: async () => ({ ok: true, route: null }) }
  : { ok: true, status: 200, json: async () => ({ ok: true, rows: factsRows, discovered: [] }) }

const reactRequire = createRequire(join(reactDomDir, 'index.js'))
const React = reactRequire('react')
const { createRoot } = reactRequire('react-dom/client')
const { act, Profiler } = React

let plugin = null
dom.window.__ModuleLoader__ = { load({ factory }) { plugin = factory((n) => { if (n === 'react') return React; throw new Error(n) }) } }
// eslint-disable-next-line no-eval
eval(readFileSync(join(root, 'lib/client.js'), 'utf8'))
const captured = {}
const slots = { inject(s, fn) { return fn() }, register(spec, Component) { captured[spec.name] = { spec, Component }; return () => {} } }
plugin.apply({
  inject(n, cb) { return cb({ locale: { getSnapshot: () => ({ active: 'en' }), subscribe: () => () => {} }, slots, modelDirectories: { directoryFor: () => ({ store, load: async () => {}, select: async () => {} }) }, sessions: { subagentAddress: () => undefined }, remote: {}, 'remote.session': {} }) },
  slots,
  effect(fn) { const d = fn(); return typeof d === 'function' ? d : undefined },
})
const seat = captured['conversation.input.model']
const props = seat.spec.inject('rc')
const reactRoot = createRoot(document.getElementById('app'))

let commits = 0, renderMs = 0
const onRender = (id, phase, actualDuration) => { commits++; renderMs += actualDuration }
const flush = (ms) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const setInputValue = (el, v) => {
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(el, v)
  el.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
}
async function window90(label, fn) {
  const c0 = commits, r0 = renderMs, s0 = subStats.subscribeCalls, u0 = subStats.unsubscribeCalls
  await fn()
  return {
    label,
    commits: commits - c0,
    renderMs: +(renderMs - r0).toFixed(1),
    sub: subStats.subscribeCalls - s0,
    unsub: subStats.unsubscribeCalls - u0,
  }
}

console.log(`render-count.mjs — ${GROUPS.length} providers / ${TOTAL} models`)
const results = []
await act(async () => { reactRoot.render(React.createElement(Profiler, { id: 'picker', onRender }, React.createElement(seat.Component, { ...props, locked: false }))) })
await flush(60)

const step = async (label, doAct, wait = 30) => {
  results.push(await window90(label, async () => { await act(doAct); await flush(wait) }))
}

await step('open popup', async () => { document.querySelector('.dsh-mp2-triggerLeft').click() }, 400)
console.log('rows in DOM after open:', document.querySelectorAll('.dsh-mp2-list .dsh-mp2-option').length)
await step('type one char', async () => { setInputValue(document.querySelector('.dsh-mp2-search'), '1') }, 400)
await step('clear query', async () => { setInputValue(document.querySelector('.dsh-mp2-search'), '') }, 400)
await step('arrow down x1', async () => { document.querySelector('.dsh-mp2-search').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) })
await step('scroll', async () => { const l = document.querySelector('.dsh-mp2-list'); l.scrollTop = 800; l.dispatchEvent(new dom.window.Event('scroll')) })
await step('toggle favorite', async () => { document.querySelector('.dsh-mp2-option .dsh-mp2-star').click() })
await step('open effort popup', async () => { document.querySelector('.dsh-mp2-triggerRight').click() })
await step('close popup (Escape)', async () => { document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })

console.log('')
console.log('interaction'.padEnd(34) + 'commits'.padStart(9) + 'render ms'.padStart(11) + 'subscribe'.padStart(11) + 'unsub'.padStart(7))
for (const x of results) console.log(x.label.padEnd(34) + String(x.commits).padStart(9) + String(x.renderMs).padStart(11) + String(x.sub).padStart(11) + String(x.unsub).padStart(7))
console.log('')
console.log(`store subscriptions over the session: ${subStats.subscribeCalls} subscribe / ${subStats.unsubscribeCalls} unsubscribe`)
console.log(`total commits: ${commits}, total render time: ${renderMs.toFixed(1)}ms`)
