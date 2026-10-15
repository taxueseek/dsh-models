# Changelog

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
