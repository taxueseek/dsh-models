# Browser-side probes

These run the **shipped `lib/client.js`** in a real Chromium — the jsdom suite
(`scripts/interaction.mjs`) is fast and portable but floors every timing at the
next animation frame and cannot synthesise a real IME composition. Use these
when a claim depends on measured browser behaviour.

They are plain HTML with no build step. `scripts/perf.mjs` and
`scripts/render-count.mjs` are the jsdom counterparts that `npm test` never runs
on their own.

## Setup

The probes load React 18 UMD builds from the harness and `lib/client.js` from
this package, so serve the directory with both:

```sh
cd scripts/browser
D="$HOME/.dsh/dsh-browser/node_modules/.pnpm"
cp "$D/react@18.3.1/node_modules/react/umd/react.development.js" ./react.js
cp "$D/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/umd/react-dom.development.js" ./react-dom.js
cp "$D/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/umd/react-dom.profiling.min.js" ./react-dom.profiling.js
cp ../../lib/client.js ./client.js
python3 -m http.server 8899
```

The copies are gitignored — regenerate them rather than committing them, so a
probe can never run against a stale `client.js`.

## The probes

| File | Answers |
|---|---|
| `bench.html` | Per-interaction timings, DOM node count, JS heap, store subscribe/unsubscribe pairs, `directory.load()` calls. Uses `React.Profiler` and `flushSync` so the numbers are React's own work rather than frame-aligned. Pass `?v=before` after copying a baseline to `client-before.js` to compare revisions in one browser. |
| `probe-ime.html` | Whether an in-flight IME composition filters the list. Drives real `compositionstart` / `compositionend` events and reports the row count at each step. |
| `probe-typing.html` | What a user feels while typing: last keystroke → settled DOM, via a `MutationObserver` on the list. Pass a debounce variant as `client-<name>.js` and select it with `?v=<name>`. |
| `probe-filter.html` | The raw cost of the filter function itself over the full model set, to tell debounce latency apart from filter latency. |

## Reading the numbers

- **Mount and trigger-only renders are ~0ms** — that is not a bug, the trigger
  renders before any list exists.
- **`flushSync` timings are the comparable ones.** A plain `await` around a
  click measures two animation frames (~33ms floor) and hides everything below
  that, which is most of what changed here.
- Prefer `store subscribe/unsubscribe` and `commits` over wall-clock for judging
  render-path changes: they are deterministic across machines, while absolute
  durations are not.
