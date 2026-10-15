<div align="center">

[English](README.md) | [简体中文](README.zh.md)

</div>

# dsh-models

## In one line

The model menu for the dsh web GUI — pick the model, its effort, and your
subagents' model, all from the composer's model seat.

## What it is

A renamed, maintained fork of
[ttmouse/dsh-model-picker](https://github.com/ttmouse/dsh-model-picker)
(v1.18.0 baseline). The upstream picker replaces the composer's model seat
with a search-first popup; this fork keeps that and adds the pieces a
multi-model daily driver needs.

A **three-zone trigger button** splits three concerns into three popups:

| Zone | Click | Popup content |
|------|-------|---------------|
| **Left** (model name) | Opens the model picker | Search box (auto-focused), provider column, model list with price badges and `dim` discovery rows |
| **Middle** (subagent icon) | Opens the subagent picker | Per-session model override for subagents (depth ≥ 1) |
| **Right** (effort) | Opens the effort picker | Available reasoning-effort levels |

Plus a settings-page 「模型选择」 card: discovery master switch,
ignore/restore for discovered models, hidden-model management — linked live
with the picker.

## Fork attribution

Upstream: [ttmouse/dsh-model-picker](https://github.com/ttmouse/dsh-model-picker)
(MIT). This repo renames the package to `dsh-models` and maintains the
enhanced build (subagent routing, `dim` bridge, settings card, zh/en locale,
custom background color, theme readability fixes). Routes
(`/api/model-picker/…`) and `dsh.modelPicker.*` storage keys keep their
upstream names so existing preferences migrate seamlessly.

## Install

Requires harness ≥ 0.2.0-rc.1 (verified on 0.2.0-rc.2).

```sh
curl -fsSL https://raw.githubusercontent.com/taxueseek/dsh-models/main/install.sh | sh
# restart dsh web
```

Manual equivalent:

```sh
# remove the siblings first — only ONE model menu per profile (shared route)
dsh plugin --profile web remove dsh-model-picker dsh-model-picker-enhanced
dsh plugin --profile web add git+https://github.com/taxueseek/dsh-models.git
# restart dsh web
```

> The npm package named `dsh-models` is an unrelated third-party placeholder —
> install only via the script or the git command above.

## Compatibility

| dsh-models | Harness | Notes |
| --- | --- | --- |
| 0.1.0 | **0.2.0-rc.2 (current, measured)** | Code-identical to the enhanced build running in production; client resolves against the official 0.2.0 slot roster. |

Requires Node.js ≥ 22.19 (the floor the picker is developed and tested on).

What was actually checked on 0.2.0-rc.2 (this code, pre-rename build):

- **Surfaces still resolve**: `conversation.input.model`, `web-ui.plugin.item`;
  every icon used exists in the official browser roster.
- **Seats that died upstream are avoided**: the alpha.2-removed
  `settings.plugin.item` seat is not used; the settings card renders as a
  plain section (no `locale` field — a localized seat entry renders invisible).
- **Server settings channel is dead on current hosts** (`scope.set()`
  resolves false), so card preferences live in `localStorage`
  (`dsh.modelPicker.*` + cross-tab event) instead of `webUiSettings`.

## Configuration

No host-side config knobs yet — the bundle entry carries no `config` block.
User preferences (discovery switch, ignored/discovered models, hidden models,
background color, per-session subagent routes) are managed from the
settings-page card and the picker itself.

## The `dim` bridge (optional)

When a `dim` CLI is present (`dim` on `PATH` or `~/.local/bin/dim`), the host
merges its catalog into the model facts: price badges, `maxOut`/`released`
facts, and discovery rows for models `dim` knows that the dsh directory does
not (capped at 30 per provider, newest first). Without `dim` the picker works
exactly like upstream — the bridge degrades to directory-only facts.

## Coexistence

`dsh-models`, `dsh-model-picker`, and `dsh-model-picker-enhanced` all serve
`/api/model-picker/models`. Mount only one per profile; the installer does not
remove the others for you (see manual equivalent above).
