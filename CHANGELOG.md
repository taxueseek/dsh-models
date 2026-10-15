# Changelog

## 0.1.1 — 2026-10-15

Performance and reliability pass (Plan A):

- **Fix: `/api/model-picker/models` returned HTTP 500 "inactive context"** —
  the facts route read `ctx.llm` from a module-level inject after the fiber
  could unload on a remote-service flap, leaving a zombie route. The route now
  rides a nested `ctx.inject(['llm'], …)` fiber (the dsh-web-all pattern):
  it exists only while `llm` is available, re-registers when it returns, and
  its disposer is collected so an unload never leaves a zombie behind.
- **Fix: collect() failure backoff** — a failed catalog build no longer spawns
  a fresh 30s collect on every request (thundering herd); failures cool down
  for 30s and serve a fast 503 instead.
- **Fix: subagent route leak** — `subagentRoutes` entries are removed when the
  owning session is disposed.
- **Perf: catalog TTL 30s → 60s** — halves the full-catalog rebuild rate
  (every provider × model × remote `resolveModel`).
- **Fix: `usePrefsSync` re-subscribed on every render** — the callback is now
  held in a ref so the PREFS_EVENT/storage listeners bind exactly once.
- **Perf: usage count computed once** — `recordUsage` returns the entry that
  `choose()` mirrors into state instead of incrementing twice.
- **Perf: settings card reuses the picker's memoized facts fetch** — one
  request instead of two concurrent ones.
- **Compat: declare dsh 0.2.1-alpha.3** (the running harness; the previous
  range did not match its prerelease tuple).

### Client render-path pass (measured on 306 rendered rows)

- **Perf: row re-render storm eliminated** — `ModelRow`'s `onChoose`/`onToggle`
  were fresh inline closures each render, defeating its `React.memo`, so every
  picker re-render (scroll spy, arrow cursor, debounced query) re-rendered all
  rows. The callbacks are now stable `useCallback` refs the row invokes with
  `(group, model)`; memo actually bails out. Measured: an arrow-key press went
  from re-rendering all 306 rows to 2 (≈153×); a keystroke-filtered list from
  1124 to 258 row renders; the list mounts once instead of twice.
- **Perf: memoized derived lists** — `grouped`, `flatRows`, and
  `visibleProviders` are now `useMemo`'d (with a stable `EMPTY_ROWS` and the
  active `locale` in the deps), removing the per-frame O(n) rebuild.
- **Fix: scroll-spy threw on every scroll** — `onListScroll` read
  `event.currentTarget` inside a `requestAnimationFrame` callback, where React
  has already nulled it, so the elevator highlight silently failed (and threw).
  The list is now captured synchronously; scrolling lights the correct section
  and re-renders zero rows.
- **Fix: subagent pick never persisted** — the component's `useState` setter
  `setSubagentRoute` shadowed the same-named module function, so
  `chooseSubagent` called the setter (a no-op returning `undefined`) and its
  `.then` threw — the POST to `/api/model-picker/subagent` never fired and the
  popup stayed busy. The module function is renamed `saveSubagentRoute`.
- **Fix: `EffortPopup`'s `React.memo` was a no-op** — it was invoked as a plain
  function (`EffortPopup({…})`) instead of an element (`h(EffortPopup, {…})`),
  bypassing memo entirely. Now mounted as an element.
- **Fix: double response → unhandled rejection** (host) — on a mid-request
  client disconnect `res.end()` throws and the `catch`'s follow-up `sendJson`
  threw again inside the fire-and-forget handler. `sendJson` now early-returns
  when `res.writableEnded || res.headersSent`, retiring that whole class.
- **Refactor: one prefs subscription** — the picker's two `usePrefsSync`
  listeners (prefs + background color) are folded into one.

## 0.1.0 — 2026-10-15

Initial public release as `dsh-models`: a renamed, maintained fork of
[ttmouse/dsh-model-picker](https://github.com/ttmouse/dsh-model-picker)
(v1.18.0 baseline).

What the fork carries over the baseline:

- Three-zone trigger: model picker (search-first) + subagent model override
  + reasoning-effort selector.
- Per-session subagent model routing (`agent/request` waterfall +
  `/api/model-picker/subagent` + localStorage persistence).
- `dim` bridge: price badges (`$in/$out` per million), `maxOut`/`released`
  facts, and new-model discovery rows grouped under real providers.
- Settings-page 「模型选择」 card (under `web-ui.plugin.item`): discovery
  master switch, ignore/restore list, hidden-model management, live linkage
  with the picker.
- Chinese/English UI following the DSH locale, custom picker background
  color, backdrop-filter readability fixes for light/dark themes.
- HTTP routes and `dsh.modelPicker.*` storage keys keep their upstream names
  so existing preferences migrate seamlessly.
