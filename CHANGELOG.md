# Changelog

## 0.1.4 — 2026-10-17

Two measured wins, both against the live host on this machine. The picker's
cost was dominated by one thing: mounting every row of a 310-row catalog on
every open (measured live: 55.3ms median, 5500 DOM nodes — the most frequent
interaction in daily use). The host's background cost was dominated by
another: re-running both `dim` subcommands (a ~10MB JSON dump) every 60
seconds for a catalog that turns over on the scale of days.

### Performance

- **The model list is virtualized.** The popup now mounts only the rows around
  the viewport (~13 of 310 live) and pads the rest with two spacer divs, so
  total height, scrollbar length and every offset stay exact. Heights are not
  measured — `.dsh-mp2-option` is a nowrap one/two-line row, so its height is a
  pure function of whether it shows a description (probed in Chromium against
  the live DOM: 38 / 50px; headers 30px; the empty-group note 40px), which also
  keeps the scroll math free of re-layout. The section label of the group the
  list is standing in is pinned by a synthetic twin once its real header
  scrolls out of the window (the real headers stay `position:sticky` as ever).
  Measured live in the running web GUI (same methodology, same machine):
  **open 58.7 → 23.5ms median** (min 50.5 → 22.6, the remainder is the frame
  floor), **310 → 13 rows mounted**, **5506 → 1170 DOM nodes**. Measured in the
  real-browser bench (276-row directory): cumulative React render across a
  full interaction session **243.2 → 65.1ms**, DOM nodes **5157 → 348**. The
  subagent popup windows the same catalog. Lists below 60 items (and jsdom,
  whose clientHeight is 0) still mount whole, so nothing about small lists
  changed.
- **The keyboard cursor scrolls the window, not the DOM.** `ensureRowVisible`
  computes the target offset from the layout and publishes it in the same
  commit as the cursor move, so the cursor row is mounted immediately —
  `scrollIntoView` cannot work on a row that is not mounted, which is the whole
  point of windowing.
- **The elevator reads no DOM.** Floors come from the layout's precomputed
  offsets instead of `offsetTop` per scroll tick; the spy and the floor jumps
  use the same table.
- **`dim` refreshes every 10 minutes, not every 60 seconds.** dim's catalog is
  a model database that turns over on the scale of days; the 60s re-ran both
  subcommands (the `provider list` dump alone is ~10MB of JSON, ~1s of CPU) on
  every catalog refresh for freshness nobody could perceive. New-model
  discovery now surfaces a model within a coffee break instead of a minute,
  and a long-running host stops paying ~1.5s of CPU per minute (plus the
  transient ~40MB of JSON parsing) for a page that may not be open.

### Fixed

- **`readPrefsLocal` was the one unguarded `localStorage` read.** Every other
  storage reader in the file degrades to defaults when storage refuses
  (private mode, quota); this one threw, taking the picker and the settings
  card down with it. Wrapped like the rest.
- **Zero-debounce search boxes committed through an effect**, costing one
  extra render per keystroke (settings card, subagent popup). The commit now
  happens in the change handler itself.
- **`reasoning.efforts` was assumed to exist** in the effort label and the
  effort choices; a model carrying reasoning without the array took the popup
  down. Guarded like the other optional reads.

### Tests

- `scripts/interaction.mjs`: 30 → 42. Adds a virtual-list section that mounts
  a 288-model directory, stubs the list's viewport to a real 320px, and drives
  the paths windowing changes: window size vs the full list, spacer math at
  depth, the pinned section label, the elevator highlight, cursor-follow
  across 30 arrow-downs and `End`, search over the windowed list, and the
  subagent popup's window.
- `scripts/perf.mjs`: `MP_VIRTUAL=1` stubs the viewport so the windowed path
  runs under jsdom for local comparison.

## 0.1.3 — 2026-10-17

Correctness and latency pass. Driven by measurement against the live host, not
by inspection: every number below came off this machine's real
`/api/model-picker/models` payload, a real Chromium run of the shipped
`lib/client.js`, or both.

### Fixed

- **The context-window badge never rendered.** `collect()` called
  `llm.resolveModel()`, which the Host `llm` service does not expose — that
  method lives on adapters. Every call threw, the per-model `catch` swallowed
  it, and each row came back without `contextWindow`: measured **0 of 252 rows**
  on the live host, with nothing logged anywhere. The service method is
  `resolveModelInfo`; the code now prefers it, falls back to `resolveModel`, and
  copes with neither being present. Measured after: **255 of 255 rows**.
- **`dim` left a copy of your provider credentials in `/tmp` on every unclean
  shutdown.** `runDim()` built a temp directory with `mkdtempSync` and
  redirected the child's stdout into it, because Node's default 1MB
  `maxBuffer` cannot hold `dim provider list --json` (~10MB). When the host was
  killed before the callback ran its `finally`, the directory survived — four
  such directories were found, ~40MB, each holding a full 10MB `out.json`
  including every provider's `apiKey.preview`. Raising `maxBuffer` to 64MB lets
  the stdout come back through the pipe, so the whole temp-file path is gone: no
  disk round trip, and nothing to strand.
- **The provider group headers did not stick.** `.dsh-mp2-groupHeader` had
  `position:relative` where the upstream CSS had `sticky`, so headings scrolled
  away instead of pinning — while the comment beside it still claimed they were
  "pinned to the top". Restored (verified in Chromium: header `top` tracks the
  list's top edge while scrolling).
- **The `dim` tag rendered in the wrong colour.** `--dsh-alias-brand-primary`
  was a typo for `--dsw-alias-brand-primary`, the only occurrence of that
  prefix in the file.
- **A stored subagent route never came back after a restart.** The host holds
  routes in memory, so a restart emptied them while `localStorage` still held
  the user's choice — and the localStorage copy was written but never read
  (`readSubagentRoute` was dead code). The picker now adopts the stored route
  when the host answers null, pushes it back, and **drops** it instead when the
  provider or model no longer exists (an unknown route makes the host reject
  every subagent request with "no adapter registered for provider"). A route the
  user cleared stays cleared.
- **The check-mark column was reserved on every row.** An unselected row left an
  empty 18px slot. The upstream rule that collapses it had been dropped.
- **Filtering ran during IME composition.** Chinese/Japanese/Korean input fires
  `onChange` for every keystroke of an in-progress word, so the list filtered on
  text the user had not finished typing — showing "no matching models" mid-word.
  All three search boxes now hold the filter until `compositionend` while the
  input keeps showing what was typed. Verified in Chromium with real composition
  events.
- **`dim` failures were completely silent.** ENOENT, a 20s timeout, the
  buffer cap and a JSON shape change all collapsed into one `dimFailedAt` with
  no log and no UI signal — the same invisibility that let the `resolveModel`
  bug live. The reason is now warned once per failure window and published on
  the facts payload as `dim: { ok, error }`.

### Performance

- **Search results now appear ~3× sooner.** The 300ms debounce bought roughly
  12ms of saved render across a seven-key word (the filter itself measures
  0.1ms over 276 models; the worst case, one character matching all 276 rows,
  renders in 17ms) while leaving the list stale for **210–230ms after the last
  keystroke**. At 80ms it still coalesces fast typing but lands within the gap
  between keystrokes.
- **The store subscription is no longer rebuilt on every render.** Inline
  arrow arguments to `useSyncExternalStore` made React tear down and re-establish
  the subscription each render — measured **56 subscribe / 55 unsubscribe pairs**
  in Chromium for one page's worth of interaction. Beyond the churn, each
  unsub/resub window is a gap where a store notification is dropped. Measured
  after: **1 / 0**.
- **The catalog no longer reloads on every render.** The seat rebuilds `load`
  inside `inject()`, so keying the effect on it re-fired the load on every
  render — measured 1 load at mount becoming 6 after five renders, and every
  keystroke, arrow press and scroll tick re-renders the picker.
- **`dim` is invoked once per candidate, not twice.** A deterministic failure
  (buffer cap, timeout, non-zero exit) now stops the candidate walk instead of
  repeating it against the second binary, which had doubled the 20s ceiling and
  pushed the total past the 30s collect deadline.
- **The pinned `dim` path is tried first again.** `execFile('dim')` resolves
  through the host's PATH, and this machine's PATH puts several third-party
  agent bin directories ahead of `~/.local/bin` — a same-named binary in any of
  them could have supplied the whole catalog silently.

### Tests

- `scripts/host-route.mjs`: 32 → 50. Adds the four model-info service shapes
  (infoOnly / modelOnly / both / neither), asserts the wider `resolveModelInfo`
  window wins when both exist, that no `dsh-models-dim-*` directory appears in
  `tmpdir()` across a collect, and that rows still build with no resolver at all.
- `scripts/interaction.mjs`: 12 → 30. Adds the IME guard, the subagent restore
  path (adopt, host-wins, dead-route drop, cleared-stays-cleared), and source
  invariants for the three CSS regressions and the memoized subscription.
- `scripts/perf.mjs`, `scripts/render-count.mjs`: new harnesses that time the
  browser half over a directory shaped like the live one (19–20 providers,
  ~280 models) and count commits / subscriptions per interaction.

## 0.1.2 — 2026-10-16

Tests + non-blocking cold start (the two things worth absorbing from the
upstream project's engineering practice; upstream has no superior render or
collect technique to copy — this fork's memo path and 60s TTL already match or
beat it):

- **Test: `scripts/host-route.mjs`** — pure-Node suite that drives the real
  route handlers with stub `llm`/`webServer`/`sessions`/`dispatch`. Covers the
  facts cache (cold 503 → warm 200, stale-while-revalidate, failure backoff),
  the `sendJson` double-response guard, the subagent route (GET/POST/DELETE +
  validation + 405), the `agent/request` override, and `session/disposed`
  cleanup. `npm test` runs it.
- **Test: `scripts/interaction.mjs`** — renders the registered `ModelPicker`
  into jsdom with a matched react-dom 18 pair and drives open/search/favorite/
  arrow/scroll/effort. Guards the `onListScroll` `event.currentTarget`-in-rAF
  regression (scroll must not throw) and asserts, as a source invariant, that
  `chooseSubagent` calls the module `saveSubagentRoute` (not the `useState`
  setter that used to shadow it). SKIPs cleanly when the harness deps are
  absent, so `npm test` stays green on machines without them.
- **Perf: non-blocking cold start (host)** — `/api/model-picker/models` no
  longer awaits the full catalog build on a cold cache (the old path blocked the
  first request after a restart for up to `COLLECT_TIMEOUT_MS`, 30s). A warm
  cache is served immediately (stale-while-revalidate); a cold cache answers a
  fast 503 while the refresh runs in the background. Measured: cold first
  response 3ms (was ~2–3s+), warms to 200 within ~3s.
- **Fix: client `loadFacts` retries the cold-start 503** — the picker backs off
  and retries the facts fetch a few times on the host's cold-start 503 so badges
  appear as soon as the refresh lands, instead of waiting for a remount; any
  other status (route genuinely absent) still gives up at once.

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
