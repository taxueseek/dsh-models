// Browser half of dsh-models. Loaded through the web plugin loader
// (window.__ModuleLoader__); React comes from the platform module table.
//
// Three-zone trigger button:
//   LEFT    (model label) → model picker popup (search-first)
//   MIDDLE  (subagent icon) → subagent model picker popup
//   RIGHT   (effort label) → effort picker popup (standalone)
//
// Data rides the SAME per-session ModelDirectory as the /model popup
// (ctx.modelDirectories), so a switch made in either surface is what the
// other shows next.
//
// dsh-models: renamed, maintained fork of ttmouse/dsh-model-picker plus:
// 1. Subagent model routing — per-session subagent model override
// 2. Custom background color — user-configurable picker background
// 3. dim bridge — price badges + new-model discovery rows
// 4. Settings-page card — discovery/ignore/hidden management
window.__ModuleLoader__.load({ id: 'dsh-models', factory: (require) => {
  var module = { exports: {} }; var exports = module.exports;

  const React = require('react')
  const { useState, useEffect, useRef, useMemo, useSyncExternalStore, Fragment } = React
  const h = React.createElement

  // --- Locale ---
  // Two display languages (zh / en). The active one follows the DSH
  // environment's language setting: the locale plugin provides `ctx.locale`,
  // and apply() below syncs LOCALE from it and re-syncs on every change.
  // navigator.language is only the fallback for when that service is absent.
  function normalizeLocale(value) {
    return String(value || '').toLowerCase().startsWith('zh') ? 'zh' : 'en'
  }
  let LOCALE = (() => {
    try {
      return normalizeLocale(navigator.language || navigator.userLanguage || '')
    } catch (e) {
      return 'en'
    }
  })()
  const localeListeners = new Set()
  function setLocale(value) {
    const next = normalizeLocale(value)
    if (next === LOCALE) return
    LOCALE = next
    for (const listener of [...localeListeners]) {
      try { listener() } catch (e) {}
    }
  }
  function subscribeLocale(listener) {
    localeListeners.add(listener)
    return () => { localeListeners.delete(listener) }
  }
  function getLocale() {
    return LOCALE
  }
  /** Re-render the calling component whenever the DSH language setting changes. */
  function useLocale() {
    return useSyncExternalStore(subscribeLocale, getLocale)
  }

  const STR = {
    zh: {
      triggerFallback: '选择模型',
      search: '搜索模型或提供商…',
      loading: '加载中…',
      retry: '重试',
      noModels: '暂无可用的模型',
      providerEmpty: '该提供商暂无模型',
      noMatch: '没有匹配的模型',
      effortHeading: '推理层级',
      providerDefault: '提供方默认',
      selectFailed: '选择失败，请重试',
      selectFailedMsg: '选择失败：',
      providers: '提供商',
      allProviders: '全部提供商',
      contextWindow: '上下文窗口',
      favorites: '收藏',
      favoritesEmpty: '还没有收藏的模型',
      favoriteAdd: '加入收藏',
      favoriteRemove: '取消收藏',
      recent: '常用',
      imageNative: '支持图片输入（模型原生视觉）',
      imageBridged: '支持图片输入（modlens 桥接：模型看到的是转写文本，不是原图）',
      loadFailed: '加载失败：',
      dimTag: 'dim 新发现：尚未登记到目录，发送时按该供应商直连',
      dimBadge: 'dim',
      setTitle: '模型选择',
      setHint: '自动发现新模型，并管理选择器里显示的模型',
      setDiscovered: 'dim 发现的新模型',
      setNoneDiscovered: '暂无发现的新模型',
      setCatalog: '目录模型',
      setSearch: '搜索模型或供应商…',
      setIgnore: '忽略',
      setRestore: '恢复',
      setHide: '隐藏',
      setHiddenCount: '已隐藏 ',
      setLoading: '设置加载中…',
      subagent: '子代理',
      subagentDesc: '为子代理选择模型',
      subagentInherit: '继承主模型',
      subagentClear: '清除子代理模型',
      bgColor: '选择器背景色',
      bgColorDesc: '自定义模型选择器的背景颜色',
      bgColorDefault: '默认',
      bgColorCustom: '自定义',
    },
    en: {
      triggerFallback: 'Select model',
      search: 'Search model or provider…',
      loading: 'Loading…',
      retry: 'Retry',
      noModels: 'No models available',
      providerEmpty: 'No models for this provider',
      noMatch: 'No matching models',
      effortHeading: 'Reasoning Effort',
      providerDefault: 'Provider default',
      selectFailed: 'Selection failed, retry',
      selectFailedMsg: 'Selection failed: ',
      providers: 'Providers',
      allProviders: 'All providers',
      contextWindow: 'Context window',
      favorites: 'Favorites',
      favoritesEmpty: 'No favorite models yet',
      favoriteAdd: 'Add to favorites',
      favoriteRemove: 'Remove from favorites',
      recent: 'Recent',
      imageNative: 'Accepts images (native vision)',
      imageBridged: 'Accepts images (modlens bridge: the model sees transcribed text, not the picture)',
      loadFailed: 'Load failed: ',
      dimTag: 'dim discovery: not in the catalog yet; sends route via this provider directly',
      dimBadge: 'dim',
      setTitle: 'Model picker',
      setHint: 'Discover new models automatically and manage what the picker shows',
      setDiscovered: 'dim discoveries',
      setNoneDiscovered: 'No new models discovered',
      setCatalog: 'Catalog models',
      setSearch: 'Search models or providers…',
      setIgnore: 'Ignore',
      setRestore: 'Restore',
      setHide: 'Hide',
      setHiddenCount: ' hidden',
      setLoading: 'Loading settings…',
      subagent: 'Subagent',
      subagentDesc: 'Pick a model for subagents',
      subagentInherit: 'Inherit main model',
      subagentClear: 'Clear subagent model',
      bgColor: 'Picker background',
      bgColorDesc: 'Custom background color for the model picker',
      bgColorDefault: 'Default',
      bgColorCustom: 'Custom',
    },
  }
  const t = (key) => STR[LOCALE][key] ?? STR.en[key]

  /** The bound settings namespace name, kept for the card identity. */
  const SETTINGS_NAMESPACE = 'dsh-models'

  // ─── Subagent model routing preferences ───
  // NOTE: storage keys intentionally keep the upstream `dsh.modelPicker.*`
  // naming so preferences migrate seamlessly from dsh-model-picker(-enhanced).

  // ─── Subagent model routing preferences ───
  // Per-session subagent model override, stored in localStorage.
  // Key: `dsh.modelPicker.subagent.<sessionId>` → { provider, model, reasoningEffort? }
  const SUBAGENT_KEY_PREFIX = 'dsh.modelPicker.subagent.'

  // ─── Custom background color ───
  // User-configurable picker background color, stored in localStorage.
  // Key: `dsh.modelPicker.bgColor` → color string (e.g. '#1a1a2e')
  const BG_COLOR_KEY = 'dsh.modelPicker.bgColor'

  function readSubagentRoute(sessionId) {
    if (typeof localStorage === 'undefined' || !sessionId) return null
    try {
      const raw = localStorage.getItem(SUBAGENT_KEY_PREFIX + sessionId)
      if (raw === null) return null
      const parsed = JSON.parse(raw)
      if (typeof parsed?.provider === 'string' && typeof parsed?.model === 'string') return parsed
      return null
    } catch {
      return null
    }
  }

  function writeSubagentRoute(sessionId, route) {
    if (typeof localStorage === 'undefined' || !sessionId) return
    try {
      if (route === null) localStorage.removeItem(SUBAGENT_KEY_PREFIX + sessionId)
      else localStorage.setItem(SUBAGENT_KEY_PREFIX + sessionId, JSON.stringify(route))
    } catch { /* storage refused */ }
  }

  function readBgColor() {
    if (typeof localStorage === 'undefined') return null
    try {
      const raw = localStorage.getItem(BG_COLOR_KEY)
      if (raw === null) return null
      // Validate hex color
      if (/^#[0-9a-fA-F]{3,8}$/.test(raw)) return raw
      return null
    } catch {
      return null
    }
  }

  function writeBgColor(color) {
    if (typeof localStorage === 'undefined') return
    try {
      if (color === null) localStorage.removeItem(BG_COLOR_KEY)
      else localStorage.setItem(BG_COLOR_KEY, color)
    } catch { /* storage refused */ }
  }

  // ─── Local preference store ───
  // The server settings channel (webUiSettings → configForms) is dead on
  // web-all 0.4.4 — the provider-assembly gap pending upstream means the
  // compat scope has neither a native form nor a loopback fallback, so every
  // scope.set() resolves false and nothing persists. The picker's preferences
  // therefore live in localStorage and broadcast a change event; the settings
  // card and the picker both speak through these helpers and stay in step
  // without a reload. Storage refusals (private mode, quota) degrade to
  // defaults instead of breaking anything.
  const PREFS_EVENT = 'dsh-model-picker:prefs'
  const PREFS_KEYS = {
    discovery: 'dsh.modelPicker.discovery',
    ignored: 'dsh.modelPicker.ignored',
    hidden: 'dsh.modelPicker.hidden',
  }
  function readPrefsLocal() {
    const flag = localStorage.getItem(PREFS_KEYS.discovery)
    const list = (key) => {
      try {
        const raw = localStorage.getItem(key)
        const parsed = raw === null ? [] : JSON.parse(raw)
        return Array.isArray(parsed) ? new Set(parsed.filter((k) => typeof k === 'string')) : new Set()
      } catch {
        return new Set()
      }
    }
    return { discovery: flag !== '0', ignored: list(PREFS_KEYS.ignored), hidden: list(PREFS_KEYS.hidden) }
  }
  function writePrefs(patch) {
    try {
      if (patch.discovery !== undefined) localStorage.setItem(PREFS_KEYS.discovery, patch.discovery ? '1' : '0')
      if (patch.ignored !== undefined) localStorage.setItem(PREFS_KEYS.ignored, JSON.stringify([...patch.ignored]))
      if (patch.hidden !== undefined) localStorage.setItem(PREFS_KEYS.hidden, JSON.stringify([...patch.hidden]))
    } catch { /* storage refused: preferences stay in-memory for this view */ }
    window.dispatchEvent(new CustomEvent(PREFS_EVENT))
  }

  /** Snapshot for the seat-less state. Module-level on purpose: it feeds
   *  useSyncExternalStore's getSnapshot, whose identity must stay stable
   *  across renders or the store contract is violated. */
  const EMPTY_STATE = { current: null, routable: null, groups: [], failures: [], status: 'idle', error: null }

  // --- Styles ---
  const CSS = `
/* ───────── root + trigger (two-zone) ───────── */
/* The label zone is sized by its content and shrinks only when the composer
   row runs out of space, so the model name stays readable. */
.dsh-mp2-root{position:relative;min-width:0;display:inline-flex}
/* max-width leaves room for the supplier chip (16px + 4px gap) on top of the
   model name budget, so wearing the chip never costs the name a character. */
.dsh-mp2-trigger{display:flex;align-items:stretch;min-width:0;max-width:240px;height:28px;border:none;border-radius:24px;outline:none;background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;font-weight:500;cursor:pointer;overflow:hidden;padding:0}
.dsh-mp2-trigger:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-mp2-trigger:focus-within{box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}
.dsh-mp2-triggerLocked{color:var(--dsw-alias-label-dimmed)}
.dsh-mp2-triggerLeft{display:flex;align-items:center;gap:4px;min-width:0;flex:0 1 auto;padding:0 2px 0 8px;border:none;background:transparent;color:inherit;font:inherit;cursor:pointer;overflow:hidden}
.dsh-mp2-triggerLeft:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}
.dsh-mp2-triggerLeft:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);border-radius:24px 0 0 24px}
.dsh-mp2-triggerLabel{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-mp2-triggerDivider{width:1px;flex:0 0 auto;background:var(--dsw-alias-border-l1)}
.dsh-mp2-triggerRight{display:flex;align-items:center;gap:2px;flex:0 0 auto;padding:0 6px;border:none;background:transparent;color:var(--dsw-alias-label-caption);font:inherit;font-size:11px;line-height:20px;cursor:pointer}
.dsh-mp2-triggerRight:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);border-radius:0 24px 24px 0}
.dsh-mp2-triggerRight:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}
/* Icons are block-level inside their wrapper. An inline <svg> sits on the text
   baseline, so the font's descender space below it pushes the glyph above the
   centre of its own line box — which is what knocked the trigger chevron and
   the row check marks off the text's horizontal line. */
.dsh-mp2-root svg{display:block}
.dsh-mp2-chevron{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-caption);transition:transform 120ms ease}
.dsh-mp2-chevronOpen{transform:rotate(180deg)}

/* ───────── menu containers ───────── */
/* A fixed height, not a max-height: the popup is anchored above the composer,
   so a content-sized box makes the whole panel jump every keystroke as the
   result set narrows. The body scrolls instead. The clamp keeps it inside the
   space above the composer (the tool row sits ~340px up in the hero layout)
   and never lets a short window collapse it to nothing. */
.dsh-mp2-menu{position:absolute;right:0;bottom:calc(100% + 8px);z-index:20;display:flex;flex-direction:column;width:min(540px,calc(100vw - 32px));height:clamp(220px,calc(100vh - 340px),400px);overflow:hidden;padding:4px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background-color:var(--dsh-mp2-bg-color, var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base, #1f2125)));background-image:linear-gradient(var(--dsw-specific-menu), var(--dsw-specific-menu));box-shadow:var(--dsw-elevation-panel,var(--dsw-shadow-lv3,0 8px 32px rgba(0,0,0,.2)));color:var(--dsw-alias-label-primary)}
/* The effort list is short and has no search box, so it stays content-sized. */
.dsh-mp2-menuEffort{width:min(280px,calc(100vw - 32px));height:auto;max-height:min(260px,calc(100vh - 340px))}

/* ───────── search ───────── */
.dsh-mp2-search{flex:0 0 auto;margin:2px 2px 6px;padding:6px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;outline:none;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
.dsh-mp2-search::placeholder{color:var(--dsw-alias-label-tertiary)}
.dsh-mp2-search:focus{border-color:var(--dsw-alias-brand-primary)}

/* ───────── body (provider tabs + model list) ───────── */
.dsh-mp2-body{display:flex;flex:1;min-height:0;gap:4px}
.dsh-mp2-providers{flex:0 0 150px;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:2px;padding:2px}
.dsh-mp2-provider{display:flex;align-items:center;gap:6px;width:100%;min-height:30px;padding:0 8px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;text-align:left;cursor:pointer}
.dsh-mp2-provider:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-mp2-providerActive{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);color:var(--dsw-alias-brand-primary);font-weight:600}
.dsh-mp2-paneCaption{padding:10px 8px 6px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}
.dsh-mp2-providerName{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-mp2-providerCount{flex:0 0 auto;padding:0 6px;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
/* Supplier group in the model list. The header is a section label, deliberately
   unlike a model row (14px/500 on a rounded hover surface): tracked-out
   uppercase, dimmed, and pinned to the top of the list while its group scrolls. */
.dsh-mp2-group{border-top:1px solid var(--dsw-alias-border-l1)}
.dsh-mp2-group:first-child{border-top:none}
.dsh-mp2-groupHeader{position:relative;top:0;z-index:1;display:flex;align-items:center;gap:5px;padding:10px 8px 4px;background-color:var(--dsh-mp2-bg-color, var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base, #1f2125)));background-image:linear-gradient(var(--dsw-specific-menu), var(--dsw-specific-menu));color:var(--dsw-alias-label-tertiary,#999);font-size:11px;line-height:16px;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.dsh-mp2-groupHeaderIcon{flex:0 0 auto;display:inline-flex}

/* ───────── model list ───────── */
.dsh-mp2-list{position:relative;flex:1;min-width:0;min-height:0;overflow-y:auto;border-left:1px solid var(--dsw-alias-border-l1);padding:0 0 2px 2px}
.dsh-mp2-status,.dsh-mp2-empty{padding:10px;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
.dsh-mp2-error,.dsh-mp2-warning{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin:4px 2px;padding:7px 8px;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}
.dsh-mp2-warning{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-state-warn-label)}
.dsh-mp2-retry{flex:0 0 auto;padding:0;border:none;background:transparent;color:inherit;font:inherit;font-weight:600;cursor:pointer}
.dsh-mp2-option{display:flex;align-items:center;gap:8px;width:100%;min-height:38px;padding:6px 8px;border:none;border-radius:10px;outline:none;background:transparent;color:inherit;text-align:left;cursor:pointer;scroll-margin-top:34px;scroll-margin-bottom:4px}
.dsh-mp2-option:hover:not(:disabled),.dsh-mp2-option:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}
/* The keyboard cursor. Focus stays in the search box, so the row the arrow
   keys stand on has to say so by itself — the hover surface marks it, and
   nothing else does. It is deliberately separate from the check mark, which
   reports the model actually in use. */
.dsh-mp2-optionActive:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dsh-mp2-option:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}
.dsh-mp2-optionCopy{display:flex;flex:1;flex-direction:column;min-width:0}
.dsh-mp2-modelName{overflow:hidden;color:inherit;font-size:14px;line-height:20px;font-weight:500;text-overflow:ellipsis;white-space:nowrap}
.dsh-mp2-description{overflow:hidden;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;text-overflow:ellipsis;white-space:nowrap}
.dsh-mp2-check{flex:0 0 18px;display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-brand-primary)}

/* ───────── per-row facts (context window / image input) ───────── */
.dsh-mp2-facts{display:flex;flex:0 0 auto;align-items:center;gap:5px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.dsh-mp2-context{flex:0 0 auto;padding:0 6px;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover)}
.dsh-mp2-image{display:inline-flex;flex:0 0 auto;align-items:center;color:var(--dsw-alias-label-tertiary)}
/* Bridged vision: the route accepts images, but the model reads a transcript. */
.dsh-mp2-imageBridged{opacity:.5}
/* The favorite toggle sits between the name and the fact strip. */
.dsh-mp2-star{flex:0 0 auto;display:inline-flex;align-items:center;font-size:13px;line-height:1;padding:0 2px;color:var(--dsw-alias-label-tertiary);opacity:.6;cursor:pointer}
.dsh-mp2-star:hover{opacity:1}
.dsh-mp2-starOn{color:var(--dsw-alias-state-warn-primary,currentColor);opacity:1}
/* Name + star share one flex row so the toggle sits right after the label. */
.dsh-mp2-nameRow{display:inline-flex;align-items:center;gap:2px}
/* The supplier's leading character, ahead of the model name. Only the tint
   carries the supplier's hue, so the glyph stays legible on either theme.
   --dsh-mp2-hue is set per row; it falls back to the brand-neutral 0. */
.dsh-mp2-avatar{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;margin-right:2px;border-radius:5px;background:hsl(var(--dsh-mp2-hue,0) 55% 50% / .18);color:inherit;font-size:10px;line-height:1;font-weight:600;text-transform:uppercase}
/* dim bridge chips: the provenance tag wears the brand tint, matching an
   active provider row. */
.dsh-mp2-dimtag{flex:0 0 auto;padding:0 5px;border-radius:6px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 16%,transparent);color:var(--dsh-alias-brand-primary);font-size:10px;line-height:14px;font-weight:600;letter-spacing:.02em}
/* The trigger's own gap already spaces the chip from the name. */
.dsh-mp2-triggerLeft .dsh-mp2-avatar{margin-right:0}
/* Same for the provider elevator — its gap:6px does the spacing. */
.dsh-mp2-provider .dsh-mp2-avatar{margin-right:0}
/* A locked trigger dims as a whole, tint included. */
.dsh-mp2-triggerLocked .dsh-mp2-avatar{opacity:.5}

/* ───────── effort popup ───────── */
.dsh-mp2-effortList{padding:2px;overflow-y:auto;flex:1}
.dsh-mp2-effortHeader{padding:6px 8px 4px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;flex:0 0 auto}

/* ───────── settings page card ───────── */
.dsh-mp2-set{display:flex;flex-direction:column;gap:6px}
.dsh-mp2-setRow{display:flex;align-items:center;justify-content:space-between;gap:12px}
.dsh-mp2-setTitle{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:600}
.dsh-mp2-setHint{color:var(--dsw-alias-label-tertiary);font-size:12px;margin-top:2px}
.dsh-mp2-switch{flex:0 0 auto;width:36px;height:20px;border:none;border-radius:10px;background:var(--dsw-alias-interactive-bg-hover);cursor:pointer;position:relative;transition:background 120ms ease}
.dsh-mp2-switchOn{background:var(--dsw-alias-brand-primary)}
.dsh-mp2-switchKnob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform 120ms ease}
.dsh-mp2-switchOn .dsh-mp2-switchKnob{transform:translateX(16px)}
.dsh-mp2-setSection{color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;margin-top:8px}
.dsh-mp2-setItem{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px}
.dsh-mp2-setItem:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-mp2-setIgnored{opacity:.55}
.dsh-mp2-setName{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font-size:13px}
.dsh-mp2-setMeta{flex:0 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:11px}
.dsh-mp2-setBtn{flex:0 0 auto;padding:2px 8px;border:none;border-radius:6px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:11px;cursor:pointer}
.dsh-mp2-setBtn:hover{color:var(--dsw-alias-label-primary)}
.dsh-mp2-setSearch{margin:2px 0;padding:6px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;outline:none;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:13px}
.dsh-mp2-setEmpty{color:var(--dsw-alias-label-tertiary);font-size:12px;padding:4px 8px}

/* ───────── subagent trigger + popup ───────── */
.dsh-mp2-triggerSub{display:flex;align-items:center;gap:2px;flex:0 0 auto;padding:0 6px;border:none;background:transparent;color:var(--dsw-alias-label-caption);font:inherit;font-size:11px;line-height:20px;cursor:pointer}
.dsh-mp2-triggerSub:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);border-radius:0}
.dsh-mp2-triggerSub:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}
.dsh-mp2-triggerSubActive{color:var(--dsw-alias-brand-primary)}
.dsh-mp2-subagentList{padding:2px;overflow-y:auto;flex:1}
.dsh-mp2-subagentHeader{padding:6px 8px 4px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;flex:0 0 auto}
.dsh-mp2-subagentHint{padding:4px 8px 8px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;flex:0 0 auto}

/* ───────── background color picker ───────── */
.dsh-mp2-bgRow{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px}
.dsh-mp2-bgRow:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-mp2-bgLabel{flex:1;min-width:0;color:var(--dsw-alias-label-primary);font-size:13px}
.dsh-mp2-bgInput{width:32px;height:24px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:transparent;cursor:pointer;padding:0}
.dsh-mp2-bgInput::-webkit-color-swatch-wrapper{padding:2px}
.dsh-mp2-bgInput::-webkit-color-swatch{border:none;border-radius:4px}
.dsh-mp2-bgReset{flex:0 0 auto;padding:2px 8px;border:none;border-radius:6px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:11px;cursor:pointer}
.dsh-mp2-bgReset:hover{color:var(--dsw-alias-label-primary)}
`

  // ─── Runtime model facts ───
  // The catalog this seat reads carries id / name / description / reasoning
  // only — no context window and no input modalities. The host half
  // republishes both from the Host `llm` service at this loopback route, so
  // the popup badges each row without a round trip per model. One fetch per
  // page load, shared by every popup instance; a missing route (older host
  // half, non-web carrier) simply yields no badges.
  const FACTS_ROUTE = '/api/model-picker/models'

  let factsPromise = null
  function loadFacts() {
    if (factsPromise !== null) return factsPromise
    factsPromise = fetch(FACTS_ROUTE, { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        const map = new Map()
        for (const row of body?.rows ?? body?.models ?? []) map.set(row.provider + '/' + row.id, row)
        return { map, discovered: Array.isArray(body?.discovered) ? body.discovered : [] }
      })
      .catch(() => {
        // A transient failure (server restart, blip) must not stick: clear the
        // memo so the next mount retries instead of serving emptiness forever.
        factsPromise = null
        return { map: new Map(), discovered: [] }
      })
    return factsPromise
  }

  // ─── Subagent model routing API ───
  const SUBAGENT_ROUTE = '/api/model-picker/subagent'

  async function fetchSubagentRoute(sessionId) {
    try {
      const response = await fetch(SUBAGENT_ROUTE + '?sessionId=' + encodeURIComponent(sessionId), { cache: 'no-store' })
      if (!response.ok) return null
      const body = await response.json()
      return body?.route ?? null
    } catch {
      return null
    }
  }

  async function setSubagentRoute(sessionId, route) {
    try {
      const response = await fetch(SUBAGENT_ROUTE + '?sessionId=' + encodeURIComponent(sessionId), {
        method: route === null ? 'DELETE' : 'POST',
        headers: { 'content-type': 'application/json' },
        ...(route !== null ? { body: JSON.stringify(route) } : {}),
      })
      return response.ok
    } catch {
      return false
    }
  }

  // ─── Favorites ───
  // Favorites are a browser-local UI preference, so they live in localStorage
  // under a `dsh.`-prefixed key — the same place the shipped conversation
  // plugin keeps its own view and width preferences. They are keyed on the
  // route (`provider/modelId`), not the bare model id, because one model id is
  // routinely served by several configured providers and favoriting one route
  // says nothing about the others.
  const FAVORITES_KEY = 'dsh.modelPicker.favorites'
  const USAGE_KEY = 'dsh.modelPicker.usage'
  const ALL_TAB = '__all__'
  const FAVORITES_TAB = '__favorites__'
  const RECENT_TAB = '__recent__'

  /** @returns the favorited `provider/modelId` keys; empty when storage is unusable. */
  function readFavorites() {
    if (typeof localStorage === 'undefined') return new Set()
    try {
      const raw = localStorage.getItem(FAVORITES_KEY)
      if (raw === null) return new Set()
      const stored = JSON.parse(raw)
      if (!Array.isArray(stored)) return new Set()
      return new Set(stored.filter((key) => typeof key === 'string'))
    } catch {
      return new Set()
    }
  }

  /** Persist the favorites. A storage refusal must not break the picker. */
  function writeFavorites(favorites) {
    if (typeof localStorage === 'undefined') return
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]))
    } catch {
      // Private mode or a full quota: the in-memory set still tracks this page.
    }
  }

  // ─── Usage tracking ───
  function readUsage() {
    if (typeof localStorage === 'undefined') return new Map()
    try {
      const raw = localStorage.getItem(USAGE_KEY)
      if (raw === null) return new Map()
      const parsed = JSON.parse(raw)
      if (typeof parsed !== 'object' || parsed === null) return new Map()
      const map = new Map()
      for (const [key, val] of Object.entries(parsed)) {
        if (typeof key === 'string' && val && typeof val.count === 'number') {
          map.set(key, { count: val.count, lastUsed: val.lastUsed || 0 })
        }
      }
      return map
    } catch {
      return new Map()
    }
  }

  function recordUsage(group, model) {
    const key = group.id + '/' + model.id
    const usage = readUsage()
    const prev = usage.get(key)
    usage.set(key, { count: (prev?.count || 0) + 1, lastUsed: Date.now() })
    if (usage.size > 200) {
      const sorted = [...usage.entries()].sort((a, b) => (a[1].lastUsed || 0) - (b[1].lastUsed || 0))
      for (const [k] of sorted.slice(0, sorted.length - 200)) usage.delete(k)
    }
    try {
      const obj = {}
      for (const [k, v] of usage) obj[k] = v
      localStorage.setItem(USAGE_KEY, JSON.stringify(obj))
    } catch { /* storage refused */ }
  }

  function providerUsageCount(providerId, usage) {
    let count = 0
    for (const [key, val] of usage) {
      if (key.startsWith(providerId + '/')) count += val.count
    }
    return count
  }

  /** Compact token count: 1000000 → "1M", 384000 → "384K". */
  function formatContext(tokens) {
    if (typeof tokens !== 'number' || !Number.isFinite(tokens) || tokens <= 0) return null
    if (tokens >= 1000000) return String(Number((tokens / 1000000).toFixed(1))) + 'M'
    return Math.round(tokens / 1000) + 'K'
  }

  // ─── Icons ───
  // Lucide (https://lucide.dev, ISC licence), inlined as paths on its 24×24
  // grid and stroked with `currentColor`. No icon font, no emoji, no runtime
  // dependency: the glyphs stay crisp at 13px and follow the theme tokens.
  const ICONS = {
    // Lucide `star`.
    star: [['path', { d: 'M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z' }]],
    // The same outline, filled — a favorited row.
    starFilled: [['path', { d: 'M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z', fill: 'currentColor', strokeWidth: 1 }]],
    // Lucide `check`.
    check: [['path', { d: 'M20 6 9 17l-5-5' }]],
    // Lucide `chevron-down`.
    chevron: [['path', { d: 'm6 9 6 6 6-6' }]],
    // Lucide `building`.
    building: [
      ['rect', { x: 4, y: 2, width: 16, height: 20, rx: 2 }],
      ['path', { d: 'M9 22v-4h6v4' }],
      ['path', { d: 'M8 6h.01' }],
      ['path', { d: 'M16 6h.01' }],
      ['path', { d: 'M12 6h.01' }],
      ['path', { d: 'M12 10h.01' }],
      ['path', { d: 'M12 14h.01' }],
      ['path', { d: 'M16 10h.01' }],
      ['path', { d: 'M16 14h.01' }],
      ['path', { d: 'M8 10h.01' }],
      ['path', { d: 'M8 14h.01' }],
    ],
    // Lucide `image`.
    image: [
      ['rect', { x: 3, y: 3, width: 18, height: 18, rx: 2 }],
      ['circle', { cx: 9, cy: 9, r: 2 }],
      ['path', { d: 'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21' }],
    ],
    // Lucide `building` — used for the subagent trigger.
    building: [
      ['rect', { x: 4, y: 2, width: 16, height: 20, rx: 2 }],
      ['path', { d: 'M9 22v-4h6v4' }],
      ['path', { d: 'M8 6h.01' }],
      ['path', { d: 'M16 6h.01' }],
      ['path', { d: 'M12 6h.01' }],
      ['path', { d: 'M12 10h.01' }],
      ['path', { d: 'M12 14h.01' }],
      ['path', { d: 'M16 10h.01' }],
      ['path', { d: 'M16 14h.01' }],
      ['path', { d: 'M8 10h.01' }],
      ['path', { d: 'M8 14h.01' }],
    ],
  }

  /** Render one {@link ICONS} entry at `size` px, inheriting the current colour. */
  function icon(name, size) {
    return h('svg', {
      width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
      stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round',
      strokeLinejoin: 'round', 'aria-hidden': true, focusable: 'false',
    }, ICONS[name].map(([tag, props], index) => h(tag, { key: index, ...props })))
  }

  const IMAGE_GLYPH = icon('image', 13)

  /**
   * A stable hue per supplier. Two providers whose leading characters collide —
   * `17an-db`, `17an-anbot` and `17an-mumiao` all start with `1` — would
   * otherwise wear the same chip and read as one supplier.
   * @param id - the supplier's route id, which is stable across sessions.
   */
  function providerHue(id) {
    let hue = 0
    for (const ch of id) hue = (hue * 31 + ch.codePointAt(0)) % 360
    return hue
  }

  /**
   * The supplier's leading character, for the row's avatar chip. Taken by code
   * point so a name starting outside the BMP is not cut in half.
   */
  function providerInitial(name) {
    const [first] = name.trim()
    return first === undefined ? '?' : first.toUpperCase()
  }

  /**
   * The supplier chip: its leading character on its own tint. Rendered both
   * ahead of a model name in the list and on the closed trigger, so the source
   * is legible before the picker is opened. The glyph carries no meaning to a
   * screen reader — the supplier is already named in the tooltip and the row
   * detail — so it is hidden from the accessibility tree.
   */
  function supplierChip(provider) {
    return h('span', {
      className: 'dsh-mp2-avatar',
      style: { '--dsh-mp2-hue': String(providerHue(provider.id)) },
      'aria-hidden': true,
    }, providerInitial(provider.name))
  }

  /**
   * The row's fact strip: vision glyph + context-window chip + dim tag.
   *
   * Vision has two states that are NOT the same capability: a route whose
   * model reads pixels itself (native), and a modlens bridge route, where the
   * model still cannot see — modlens transcribes the image to text first.
   * `bridged` marks the second, so the glyph can say which. The dim tag marks
   * a row the harness catalog does not advertise yet; dim's pricing metadata
   * stays on the facts payload for the model-management surface, deliberately
   * not rendered here — the picker is a selector, not a price board.
   */
  function ModelFacts({ facts, bridged, dim }) {
    useLocale()
    const context = formatContext(facts?.contextWindow)
    const image = bridged || (Array.isArray(facts?.input) && facts.input.includes('image'))
    if (!image && context === null && dim !== true) return null
    return h('span', { className: 'dsh-mp2-facts' },
      image && h('span', {
        className: 'dsh-mp2-image' + (bridged ? ' dsh-mp2-imageBridged' : ''),
        title: bridged ? t('imageBridged') : t('imageNative'),
      }, IMAGE_GLYPH),
      context !== null && h('span', { className: 'dsh-mp2-context', title: t('contextWindow') }, context),
      dim === true && h('span', { className: 'dsh-mp2-dimtag', title: t('dimTag') }, t('dimBadge')),
    )
  }

  /**
   * One selectable model row: name, favorite toggle, fact strip, check mark.
   *
   * The row is a `<button>`, so the star is a focusable span that stops the
   * click from reaching it — clicking a star must never also pick the model.
   */
  const ModelRow = React.memo(function ModelRow({ id, group, provider, model, detail, selected, active, busy, favorite, facts, bridged, dim, onToggle, onChoose }) {
    useLocale()
    const label = favorite ? t('favoriteRemove') : t('favoriteAdd')
    // The chip names the *display* supplier, so a folded `(modlens vision)` row
    // wears the same chip as its siblings under the base provider's heading.
    const chip = provider ?? group
    return h('button', {
      id,
      type: 'button',
      role: 'menuitemradio',
      'aria-checked': selected,
      className: 'dsh-mp2-option' + (selected ? ' dsh-mp2-selected' : '') + (active ? ' dsh-mp2-optionActive' : ''),
      disabled: busy,
      onClick: onChoose,
    },
      h('span', { className: 'dsh-mp2-optionCopy' },
        h('span', { className: 'dsh-mp2-nameRow' },
          supplierChip(chip),
          h('span', { className: 'dsh-mp2-modelName' }, model.name),
          h('span', {
            className: 'dsh-mp2-star' + (favorite ? ' dsh-mp2-starOn' : ''),
            role: 'button',
            tabIndex: 0,
            'aria-pressed': favorite,
            'aria-label': label + '：' + model.name,
            title: label,
            onClick: (event) => { event.stopPropagation(); onToggle() },
            onKeyDown: (event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              event.stopPropagation()
              onToggle()
            },
          }, icon(favorite ? 'starFilled' : 'star', 14)),
        ),
        detail !== undefined && detail !== '' && h('span', { className: 'dsh-mp2-description' }, detail),
      ),
      h(ModelFacts, { facts, bridged, dim, reasoning: model.reasoning }),
      h('span', { className: 'dsh-mp2-check' }, selected && icon('check', 14)),
    )
  })

  // ─── Helper: render one effort list popup ───
  function EffortPopup({ reasoning, effectiveEffort, effortChoices, busy, chooseEffort, close }) {
    if (reasoning === undefined || effortChoices.length === 0) {
      return h('div', { className: 'dsh-mp2-menu dsh-mp2-menuEffort', role: 'menu', tabIndex: -1,
        onMouseDown: (e) => { e.preventDefault() } },
        h('div', { className: 'dsh-mp2-empty' }, t('providerDefault')),
      )
    }
    return h('div', { className: 'dsh-mp2-menu dsh-mp2-menuEffort', role: 'menu', tabIndex: -1,
      onMouseDown: (e) => { e.preventDefault() } },
      h('div', { className: 'dsh-mp2-effortHeader' }, t('effortHeading')),
      h('div', { className: 'dsh-mp2-effortList' },
        effortChoices.map((level) => h('button', {
          key: level.key,
          type: 'button',
          role: 'menuitemradio',
          'aria-checked': effectiveEffort === level.effort,
          className: 'dsh-mp2-option' + (effectiveEffort === level.effort ? ' dsh-mp2-selected' : ''),
          disabled: busy,
          title: level.description,
          onClick: () => { chooseEffort(level.effort) },
        },
          h('span', { className: 'dsh-mp2-optionCopy' },
            h('span', { className: 'dsh-mp2-modelName' }, level.label),
            level.description !== undefined && h('span', { className: 'dsh-mp2-description' }, level.description),
          ),
          h('span', { className: 'dsh-mp2-check' }, effectiveEffort === level.effort ? icon('check', 14) : ''),
        )),
      ),
    )
  }

  // ─── Subagent model picker popup ───
  function SubagentPopup({ sessionId, groups, current, facts, busy, onSelect, onClose }) {
    const [query, setQuery] = useState('')
    const [activeIndex, setActiveIndex] = useState(0)
    const searchRef = useRef(null)
    const listRef = useRef(null)

    const q = query.trim().toLowerCase()
    const searching = q !== ''

    // Flatten all models from all groups
    const allModels = useMemo(() => {
      const out = []
      for (const group of groups) {
        for (const model of group.models) {
          out.push({ group, model })
        }
      }
      return out
    }, [groups])

    // Filter by query
    const filtered = useMemo(() => {
      if (!searching) return allModels
      return allModels.filter(({ group, model }) =>
        model.name.toLowerCase().includes(q) ||
        (model.description !== undefined && model.description.toLowerCase().includes(q)) ||
        group.name.toLowerCase().includes(q)
      )
    }, [allModels, searching, q])

    // Auto-focus search on open
    useEffect(() => {
      requestAnimationFrame(() => { searchRef.current?.focus() })
    }, [])

    // Reset cursor on new query
    useEffect(() => { setActiveIndex(0) }, [query])

    // Keep cursor on screen
    useEffect(() => {
      if (listRef.current === null) return
      const node = listRef.current.querySelector('.dsh-mp2-optionActive')
      if (node !== null && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest' })
    }, [activeIndex, filtered.length])

    // Close on Escape
    useEffect(() => {
      const handler = (event) => {
        if (event.key === 'Escape') onClose()
      }
      document.addEventListener('keydown', handler)
      return () => document.removeEventListener('keydown', handler)
    }, [onClose])

    // Close on outside click
    useEffect(() => {
      const handler = (event) => {
        if (listRef.current && !listRef.current.contains(event.target)) onClose()
      }
      document.addEventListener('mousedown', handler)
      return () => document.removeEventListener('mousedown', handler)
    }, [onClose])

    const moveCursor = (delta) => {
      const count = filtered.length
      if (count === 0) return
      const from = activeIndex === -1 ? 0 : activeIndex
      setActiveIndex(Math.min(Math.max(from + delta, 0), count - 1))
    }

    const onKeyDown = (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      switch (event.key) {
        case 'ArrowDown': event.preventDefault(); moveCursor(1); break
        case 'ArrowUp': event.preventDefault(); moveCursor(-1); break
        case 'Enter':
          if (event.target !== searchRef.current) return
          event.preventDefault()
          if (filtered[activeIndex]) onSelect(filtered[activeIndex].group, filtered[activeIndex].model)
          break
        default: break
      }
    }

    const currentProvider = current?.provider ?? null
    const currentModelId = current?.model ?? null

    return h('div', {
      className: 'dsh-mp2-menu dsh-mp2-menuEffort',
      role: 'menu',
      tabIndex: -1,
      onKeyDown,
      onMouseDown: (e) => { e.preventDefault() },
    },
      h('div', { className: 'dsh-mp2-subagentHeader' }, t('subagentDesc')),
      h('input', {
        ref: searchRef,
        type: 'text',
        className: 'dsh-mp2-search',
        placeholder: t('search'),
        value: query,
        onChange: (event) => { setQuery(event.target.value) },
      }),
      h('div', { className: 'dsh-mp2-subagentList', ref: listRef },
        filtered.length === 0
          ? h('div', { className: 'dsh-mp2-empty' }, searching ? t('noMatch') : t('noModels'))
          : filtered.map(({ group, model }, index) => {
              const selected = currentProvider === group.id && currentModelId === model.id
              const modelFacts = facts?.get(group.id + '/' + model.id)
              return h('button', {
                key: group.id + '/' + model.id,
                type: 'button',
                role: 'menuitemradio',
                'aria-checked': selected,
                className: 'dsh-mp2-option' + (selected ? ' dsh-mp2-selected' : '') + (index === activeIndex ? ' dsh-mp2-optionActive' : ''),
                disabled: busy,
                onClick: () => { onSelect(group, model) },
              },
                h('span', { className: 'dsh-mp2-optionCopy' },
                  h('span', { className: 'dsh-mp2-nameRow' },
                    supplierChip(group),
                    h('span', { className: 'dsh-mp2-modelName' }, model.name),
                  ),
                  model.description !== undefined && model.description !== '' && h('span', { className: 'dsh-mp2-description' }, model.description),
                ),
                h(ModelFacts, { facts: modelFacts, bridged: VISION_ROUTE.test(group.name), dim: false }),
                h('span', { className: 'dsh-mp2-check' }, selected ? icon('check', 14) : ''),
              )
            }),
      ),
      h('div', { className: 'dsh-mp2-subagentHint' },
        h('button', {
          type: 'button',
          className: 'dsh-mp2-setBtn',
          onClick: () => onSelect(null, null),
        }, t('subagentInherit')),
      ),
    )
  }

  /** A provider name that is another provider's name plus a "(…)" capability suffix. */
  const CAPABILITY_SUFFIX = /^(.*?)\s*\([^()]*\)$/
  /** A provider route modlens mints to bridge images to a text-only model. */
  const VISION_ROUTE = /\(modlens vision\)/i

  /**
   * Fold capability-suffixed providers into their base provider for display.
   * Each entry keeps `{ group, model }` pairs so a pick still submits the group
   * that serves the model; only the column rows are merged.
   * @param groups - the directory's provider groups, in host order.
   * @returns display rows, ordered by each base provider's first appearance.
   */
  function mergeProviders(groups) {
    const byName = new Map(groups.map((group) => [group.name, group]))
    const rowIdOfGroup = new Map()
    for (const group of groups) {
      const suffix = CAPABILITY_SUFFIX.exec(group.name)
      const base = suffix === null ? undefined : byName.get(suffix[1])
      rowIdOfGroup.set(group.id, base !== undefined && base !== group ? base.id : group.id)
    }
    const rows = []
    const byId = new Map()
    for (const group of groups) {
      const id = rowIdOfGroup.get(group.id)
      let row = byId.get(id)
      if (row === undefined) {
        const base = groups.find((candidate) => candidate.id === id) ?? group
        row = { id, name: base.name, models: [] }
        byId.set(id, row)
        rows.push(row)
      }
      for (const model of group.models) row.models.push({ group, model })
    }
    return rows
  }

  /**
   * The section owning a scroll offset — the last one whose top edge has
   * passed the list's own top edge. With sticky headers that is exactly the
   * heading currently pinned, so it is the floor the list is standing on.
   * @param floors - `{ id, top }` per section, in list order.
   * @param scrollTop - the list's current scroll offset.
   * @returns the owning section id, or null for an empty list.
   */
  function floorAt(floors, scrollTop) {
    let current = null
    for (const floor of floors) {
      if (floor.top > scrollTop + 1) break
      current = floor.id
    }
    return current
  }

  // ─── Main component ───
  function ModelPicker(props) {
    useLocale()
    const locked = props.locked
    const available = props.available
    const directory = props.directory
    const load = props.load
    const select = props.select
    const sessionId = props.sessionId

    const state = useSyncExternalStore(
      (fn) => directory === null ? (() => {}) : directory.subscribe(fn),
      () => directory === null ? EMPTY_STATE : directory.getSnapshot(),
    )

    // Which popup is open: null | 'model' | 'effort' | 'subagent'
    const [openKind, setOpenKind] = useState(null)
    const [query, setQuery] = useState('')
    // Debounced query: the full filter runs 300ms after typing stops, not on
    // every keystroke. With 100+ models this keeps typing responsive.
    const [debouncedQuery, setDebouncedQuery] = useState('')
    useEffect(() => {
      const timer = setTimeout(() => setDebouncedQuery(query), 300)
      return () => clearTimeout(timer)
    }, [query])
    // Provider row used to narrow an active query; null keeps every provider.
    const [facetId, setFacetId] = useState(null)
    // The group under the list's top edge — the elevator's current floor.
    const [spyId, setSpyId] = useState(null)
    // The keyboard cursor: which row the arrow keys are standing on. It is not
    // `current` (the model actually in use) — the cursor only travels, and
    // Enter commits it. The picker is search-first, so focus never leaves the
    // search box; the cursor is what the keyboard drives instead.
    const [activeIndex, setActiveIndex] = useState(0)
    const [notice, setNotice] = useState(null)
    // Favorited `provider/modelId` keys, mirrored to localStorage on every edit.
    const [favorites, setFavorites] = useState(readFavorites)
    // Runtime facts keyed `provider/modelId`; null until the one fetch lands.
    const [facts, setFacts] = useState(null)
    const [dimDiscovered, setDimDiscovered] = useState([])
    // Discovery switch, ignored discoveries, hidden catalog models — all in
    // the local preference store; the picker listens for change events so the
    // settings card and the picker stay in step without a reload.
    const [prefs, setPrefs] = useState(() => readPrefsLocal())
    useEffect(() => {
      const update = () => setPrefs(readPrefsLocal())
      window.addEventListener(PREFS_EVENT, update)
      window.addEventListener('storage', update)
      return () => {
        window.removeEventListener(PREFS_EVENT, update)
        window.removeEventListener('storage', update)
      }
    }, [])
    // ─── Subagent model routing ───
    const [subagentRoute, setSubagentRoute] = useState(null)
    const [subagentBusy, setSubagentBusy] = useState(false)
    useEffect(() => {
      if (!sessionId) return
      fetchSubagentRoute(sessionId).then((route) => setSubagentRoute(route))
    }, [sessionId])
    // ─── Custom background color ───
    const [bgColor, setBgColor] = useState(() => readBgColor())
    useEffect(() => {
      const update = () => setBgColor(readBgColor())
      window.addEventListener(PREFS_EVENT, update)
      window.addEventListener('storage', update)
      return () => {
        window.removeEventListener(PREFS_EVENT, update)
        window.removeEventListener('storage', update)
      }
    }, [])
    const lastActionRef = useRef('load')
    const rootRef = useRef(null)
    const triggerLeftRef = useRef(null)
    const triggerRightRef = useRef(null)
    const triggerSubRef = useRef(null)
    const searchRef = useRef(null)
    const listRef = useRef(null)
    const groupRefs = useRef(new Map())

    const q = debouncedQuery.trim().toLowerCase()
    const current = state.current

    const currentChoice = useMemo(() => {
      if (current === null) return null
      for (const group of state.groups) {
        if (group.id !== current.provider) continue
        for (const model of group.models) {
          if (model.id === current.model) return { group, model }
        }
      }
      return null
    }, [state.groups, current])

    // Reasoning / effort
    const reasoning = currentChoice === null ? undefined : currentChoice.model.reasoning
    const effectiveEffort = current === null ? undefined : (current.reasoningEffort ?? reasoning?.defaultEffort)
    const effortLabel = reasoning === undefined ? undefined
      : effectiveEffort === undefined ? t('providerDefault')
        : (reasoning.efforts.find((level) => level.id === effectiveEffort)?.name ?? String(effectiveEffort))
    const effortChoices = useMemo(() => {
      if (reasoning === undefined) return []
      const rows = []
      if (reasoning.defaultEffort === undefined) {
        rows.push({ key: 'provider-default', effort: undefined, label: t('providerDefault') })
      }
      for (const level of reasoning.efforts) {
        rows.push({ key: level.id, effort: level.id, label: level.name, description: level.description })
      }
      return rows
    }, [reasoning])

    // Providers differing only by a trailing capability suffix in parentheses
    // fold into their base provider: modlens registers vision as its own
    // provider route, which would otherwise put a near-duplicate row per
    // provider in the column. Folding is display-only — every row keeps its
    // models paired with the group that actually serves them, so a pick still
    // submits the original provider id and the suffix stays on the model name.
    const providers = useMemo(() => mergeProviders(state.groups), [state.groups])

    // dim discovery: models dim lists under an endpoint-shared provider that
    // the catalog does not advertise yet. Appended to their serving provider's
    // rows — each entry keeps the REAL group as its route, so a pick submits
    // that provider id plus the new model id — and tagged for provenance.
    const dimByProviderId = useMemo(() => {
      const out = new Map()
      for (const entry of dimDiscovered) {
        const bucket = out.get(entry.provider)
        if (bucket === undefined) out.set(entry.provider, [entry])
        else bucket.push(entry)
      }
      return out
    }, [dimDiscovered])

    const providersWithDim = useMemo(() => {
      const hidden = prefs.hidden
      return providers.map((row) => {
        // Every catalog id of this display row, hidden or not: a dim arrival
        // whose id is already known must not surface again just because its
        // catalog twin is hidden.
        const known = new Set(row.models.map((entry) => entry.model.id))
        let models = row.models
        if (hidden.size > 0) {
          models = models.filter((entry) => !hidden.has(entry.group.id + '/' + entry.model.id))
        }
        if (prefs.discovery && dimByProviderId.size > 0) {
          const additions = []
          for (const entry of row.models) {
            for (const d of dimByProviderId.get(entry.group.id) ?? []) {
              const key = entry.group.id + '/' + d.id
              if (known.has(d.id) || hidden.has(key) || prefs.ignored.has(key)) continue
              known.add(d.id)
              additions.push({
                group: entry.group,
                model: { id: d.id, name: d.name, ...(d.released === undefined ? {} : { description: d.released }) },
                dim: true,
              })
            }
          }
          if (additions.length > 0) models = [...models, ...additions]
        }
        return models === row.models ? row : { ...row, models }
      }).filter((row) => row.models.length > 0)
    }, [providers, dimByProviderId, prefs])

    // Search narrows BOTH columns: the query is a facet over providers as
    // well as models, so a provider matches by its own name/id or by having
    // at least one matching model.
    const searching = q !== ''
    const favoriteKey = (group, model) => group.id + '/' + model.id
    const isFavorite = (group, model) => favorites.has(favoriteKey(group, model))
    const toggleFavorite = (group, model) => {
      const key = favoriteKey(group, model)
      const next = new Set(favorites)
      if (!next.delete(key)) next.add(key)
      writeFavorites(next)
      setFavorites(next)
    }
    const matches = useMemo(() => {
      if (!searching) return []
      const out = []
      for (const provider of providersWithDim) {
        const providerMatch = provider.name.toLowerCase().includes(q) || provider.id.toLowerCase().includes(q)
        const models = providerMatch
          ? provider.models
          : provider.models.filter(({ model }) => model.name.toLowerCase().includes(q)
              || (model.description !== undefined && model.description.toLowerCase().includes(q)))
        if (providerMatch || models.length > 0) out.push({ provider, models })
      }
      return out
    }, [searching, q, providersWithDim])

    // A clicked provider narrows the search to that provider; NULL keeps the
    // cross-provider result list.
    const facet = searching && facetId !== null && matches.some((item) => item.provider.id === facetId)
      ? facetId
      : null

    // Every model across every provider, paired with the route that serves it.
    const allModels = useMemo(() => providersWithDim.flatMap((row) => row.models), [providersWithDim])
    const favoriteRows = useMemo(
      () => allModels.filter(({ group, model }) => favorites.has(group.id + '/' + model.id)),
      [allModels, favorites],
    )

    const searchAll = useMemo(() => matches.flatMap((item) => item.models), [matches])

    const results = useMemo(() => {
      if (!searching) return []
      if (facet === null) return searchAll
      const item = matches.find((entry) => entry.provider.id === facet)
      return item === undefined ? [] : item.models
    }, [searching, searchAll, matches, facet])
    const matchCounts = useMemo(() => new Map(matches.map((item) => [item.provider.id, item.models.length])), [matches])

    // Provider column: filtered while searching, complete otherwise.
    const visibleProviders = searching ? matches.map((item) => item.provider) : providersWithDim

    // The right column is one list: the 常用 group (most-used models), then
    // the 收藏 group (a mirrored copy), then every provider group. Searching
    // replaces it with flat results.
    const usage = useMemo(() => readUsage(), [favorites])
    const recentRows = useMemo(() => {
      const entries = [...usage.entries()].sort((a, b) => b[1].lastUsed - a[1].lastUsed).slice(0, 8)
      const rows = []
      for (const [key, val] of entries) {
        const slash = key.indexOf('/')
        if (slash < 0) continue
        const providerId = key.slice(0, slash)
        const modelId = key.slice(slash + 1)
        for (const group of state.groups) {
          if (group.id !== providerId) continue
          for (const model of group.models) {
            if (model.id === modelId) { rows.push({ group, model, usageCount: val.count }); break }
          }
          break
        }
      }
      return rows
    }, [usage, state.groups])

    const sortedProviders = useMemo(() => {
      return [...providersWithDim].sort((a, b) => {
        const aCount = providerUsageCount(a.id, usage)
        const bCount = providerUsageCount(b.id, usage)
        if (aCount !== bCount) return bCount - aCount
        return a.name.localeCompare(b.name)
      })
    }, [providersWithDim, usage])

    const sortedProvidersWithDim = useMemo(() => {
      return sortedProviders.map((row) => {
        const sorted = [...row.models].sort((a, b) => {
          const aKey = a.group.id + '/' + a.model.id
          const bKey = b.group.id + '/' + b.model.id
          const aCount = usage.get(aKey)?.count || 0
          const bCount = usage.get(bKey)?.count || 0
          if (aCount !== bCount) return bCount - aCount
          const aLast = usage.get(aKey)?.lastUsed || 0
          const bLast = usage.get(bKey)?.lastUsed || 0
          return bLast - aLast
        })
        return sorted === row.models ? row : { ...row, models: sorted }
      })
    }, [sortedProviders, usage])

    const grouped = searching
      ? null
      : [
          ...(recentRows.length > 0 ? [{ id: RECENT_TAB, name: t('recent'), models: recentRows }] : []),
          { id: FAVORITES_TAB, name: t('favorites'), models: favoriteRows },
          ...sortedProvidersWithDim,
        ]
    const rows = searching ? results : []

    // The same list, flattened in render order. The keyboard cursor is an index
    // into this, so an empty 收藏 group is simply skipped rather than standing
    // in the way of the first model.
    const flatRows = grouped === null ? rows : grouped.flatMap((group) => group.models)
    const activeAt = flatRows.length === 0 ? -1 : Math.min(activeIndex, flatRows.length - 1)
    const activeRow = activeAt === -1 ? null : flatRows[activeAt]
    /** The DOM id the search box points `aria-activedescendant` at. */
    const optionId = (index) => 'dsh-mp2-opt-' + index

    // Which left-column row is lit: the query facet while searching, otherwise
    // the section pinned at the list's top edge. At scrollTop 0 the spy lands
    // on the recent group (or favorites if no recent), so "常用" is lit by default.
    const highlighted = searching
      ? (facet === null ? ALL_TAB : facet)
      : (spyId ?? (recentRows.length > 0 ? RECENT_TAB : FAVORITES_TAB))

    // Search results span providers, so their rows always name the serving route.
    const rowDetail = (group, model) =>
      model.description === undefined ? group.name : group.name + ' · ' + model.description

    // The display supplier a route belongs to. A folded `(modlens vision)` route
    // has no row of its own, so its models must wear their base provider's chip
    // rather than one of their own.
    /** group id → its display row, prebuilt so row rendering stays O(1). */
    const displayRowByGroupId = useMemo(() => {
      const out = new Map()
      for (const row of providersWithDim) {
        for (const entry of row.models) out.set(entry.group.id, row)
      }
      return out
    }, [providersWithDim])
    const displayProviderOf = (group) => displayRowByGroupId.get(group.id) ?? group

    const busy = state.status === 'selecting'
    const modelLabel = currentChoice === null ? t('triggerFallback') : currentChoice.model.name
    // The supplier behind the current selection, for the chip the trigger wears
    // and the tooltip it shows. Both name the *display* supplier, so a selection
    // on a folded `(modlens vision)` route reads as its base provider — matching
    // the column the user picked from.
    const currentProvider = currentChoice === null ? null : displayProviderOf(currentChoice.group)
    // One model id is routinely served by several providers, so the model name
    // alone does not say where the model runs.
    const modelTip = currentChoice === null ? modelLabel
      : currentProvider.name + ' · ' + currentChoice.model.name
    const factsOf = (group, model) => (facts === null ? undefined : facts.get(group.id + '/' + model.id))

    const reload = () => {
      lastActionRef.current = 'load'
      load()
    }

    // ── Elevator ──
    // The grouped list is a table of contents with 收藏 as its first floor,
    // followed by every provider. Scrolling the list lights the left column
    // row for the section pinned at the list's top edge.
    const floors = () =>
      (grouped ?? []).map((g) => ({
        id: g.id,
        top: groupRefs.current.get(g.id)?.offsetTop ?? 0,
      }))

    /**
     * Jump the list to a floor. The left column is a table of contents, not a
     * ride: a supplier click has to land on its group at once, so the scroll is
     * instant rather than animated. jsdom and older carriers have no `scrollTo`
     * at all, hence the plain-offset fallback.
     */
    const scrollList = (list, top) => {
      if (list === null) return
      if (typeof list.scrollTo === 'function') list.scrollTo({ top, behavior: 'auto' })
      else list.scrollTop = top
    }

    const scrollToFloor = (id) => {
      const node = groupRefs.current.get(id)
      if (node === undefined) return
      scrollList(listRef.current, node.offsetTop)
      setSpyId(id)
    }

    /** Click on a supplier row: a facet while a query is active, else a floor. */
    const pickProvider = (id) => {
      if (searching) {
        setFacetId(facetId === id ? null : id)
        return
      }
      scrollToFloor(id)
    }

    // Throttled scroll handler: floors() reads DOM offsets, so it runs at
    // most once per animation frame, not on every scroll event.
    const scrollRafRef = useRef(0)
    const onListScroll = (event) => {
      if (searching) return
      if (scrollRafRef.current !== 0) return
      scrollRafRef.current = requestAnimationFrame(() => {
        scrollRafRef.current = 0
        setSpyId(floorAt(floors(), event.currentTarget.scrollTop))
      })
    }

    useEffect(() => {
      if (!available) return
      lastActionRef.current = 'load'
      load()
    }, [available, load])

    // Model facts are host-wide, not per session: fetch once while mounted.
    useEffect(() => {
      if (!available) return
      let live = true
      loadFacts().then((body) => {
        if (!live) return
        setFacts(body.map)
        setDimDiscovered(body.discovered)
      })
      return () => { live = false }
    }, [available])

    // Auto-focus search when model popup opens
    useEffect(() => {
      if (openKind === 'model') {
        requestAnimationFrame(() => { searchRef.current?.focus() })
      }
    }, [openKind])

    // Every new popup and every new result set starts on the first row, so the
    // arrow keys work the moment the panel is open.
    useEffect(() => { setActiveIndex(0) }, [openKind, query, facetId])

    // Keep the cursor on screen. `scroll-margin-top` in the stylesheet keeps the
    // sticky group header from covering the row it scrolled to.
    useEffect(() => {
      if (openKind !== 'model' || listRef.current === null) return
      const node = listRef.current.querySelector('.dsh-mp2-optionActive')
      if (node !== null && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest' })
    }, [openKind, activeIndex, query, facetId, flatRows.length])

    // A new query starts broad: the previous provider facet no longer applies.
    useEffect(() => { setFacetId(null) }, [query])

    // Close on Escape
    useEffect(() => {
      if (openKind === null) return
      const handler = (event) => {
        if (event.key === 'Escape') {
          setOpenKind(null)
          setNotice(null)
          setFacetId(null)
          setSpyId(null)
          setQuery('')
        }
      }
      document.addEventListener('keydown', handler)
      return () => document.removeEventListener('keydown', handler)
    }, [openKind])

    // Close on outside click
    useEffect(() => {
      if (openKind === null) return
      const handler = (event) => {
        if (rootRef.current && !rootRef.current.contains(event.target)) {
          setOpenKind(null)
          setNotice(null)
          setFacetId(null)
          setSpyId(null)
          setQuery('')
        }
      }
      // Use mousedown to catch clicks before the menu loses focus
      document.addEventListener('mousedown', handler)
      return () => document.removeEventListener('mousedown', handler)
    }, [openKind])

    // Blur handling for model menu
    const onModelBlur = (event) => {
      const related = event.relatedTarget
      if (related !== null && rootRef.current !== null && rootRef.current.contains(related)) return
      // Clicking the effort trigger button is fine
      if (related === triggerRightRef.current) return
      setOpenKind(null)
      setNotice(null)
      setFacetId(null)
      setSpyId(null)
      setQuery('')
    }

    const close = (restoreFocus) => {
      setOpenKind(null)
      setNotice(null)
      setFacetId(null)
      setSpyId(null)
      setQuery('')
      if (restoreFocus && triggerLeftRef.current !== null) triggerLeftRef.current.focus()
    }

    const settle = (accepted) => {
      if (accepted) {
        close(true)
        return
      }
      const message = directory === null ? null : directory.getSnapshot().error
      setNotice(message === null ? t('selectFailed') : t('selectFailedMsg') + message)
    }

    // --- Select a model ---
    const choose = (group, model) => {
      if (current !== null && current.provider === group.id && current.model === model.id) {
        close(true)
        return
      }
      recordUsage(group, model)
      lastActionRef.current = 'select'
      const effort = (current !== null && current.provider === group.id)
        ? current.reasoningEffort
        : model.reasoning?.defaultEffort
      const selection = {
        provider: group.id,
        model: model.id,
        ...(effort === undefined ? {} : { reasoningEffort: effort }),
      }
      void select(selection).then(settle)
    }

    // --- Select reasoning effort independently ---
    const chooseEffort = (effort) => {
      if (current === null) return
      if (effectiveEffort === effort) return
      lastActionRef.current = 'select'
      const selection = {
        provider: current.provider,
        model: current.model,
        ...(effort === undefined ? {} : { reasoningEffort: effort }),
      }
      void select(selection).then(settle)
    }

    // --- Select subagent model ---
    const chooseSubagent = (group, model) => {
      if (!sessionId) return
      setSubagentBusy(true)
      const route = group === null ? null : {
        provider: group.id,
        model: model.id,
        ...(model.reasoning?.defaultEffort !== undefined ? { reasoningEffort: model.reasoning.defaultEffort } : {}),
      }
      void setSubagentRoute(sessionId, route).then((ok) => {
        if (ok) {
          writeSubagentRoute(sessionId, route)
          setSubagentRoute(route)
          setOpenKind(null)
        }
        setSubagentBusy(false)
      })
    }

    // --- Keyboard ---
    // The whole popup is drivable from the search box: ↑/↓ walk the list, Enter
    // commits the row the cursor is on. Focus stays in the input, so the cursor
    // is reported to assistive tech through `aria-activedescendant` rather than
    // by moving DOM focus — typing keeps filtering after every arrow press.
    const moveCursor = (delta) => {
      const count = flatRows.length
      if (count === 0) return
      const from = activeAt === -1 ? 0 : activeAt
      setActiveIndex(Math.min(Math.max(from + delta, 0), count - 1))
    }

    const onMenuKeyDown = (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      switch (event.key) {
        case 'ArrowDown': event.preventDefault(); moveCursor(1); break
        case 'ArrowUp': event.preventDefault(); moveCursor(-1); break
        case 'Home': event.preventDefault(); setActiveIndex(0); break
        case 'End': event.preventDefault(); setActiveIndex(flatRows.length - 1); break
        case 'PageDown': event.preventDefault(); moveCursor(10); break
        case 'PageUp': event.preventDefault(); moveCursor(-10); break
        case 'Enter':
          // Enter belongs to the search box alone. On a focused row or star the
          // button's own activation must win, or Enter on a star would both
          // favorite and pick a model.
          if (event.target !== searchRef.current) return
          event.preventDefault()
          if (activeRow !== null) choose(activeRow.group, activeRow.model)
          break
        default: break
      }
    }

    if (!available || directory === null) return null

    // Rows are numbered in render order, which is exactly `flatRows` order, so
    // the cursor can address one by index and the search box can name it in
    // `aria-activedescendant`. Numbering by position rather than by route keeps
    // the two copies of a favorited model — the 收藏 mirror and the row under
    // its supplier — from lighting up together.
    let rowCursor = -1
    const takeRowIndex = () => { rowCursor += 1; return rowCursor }

    // ─── Render ───
    // Apply custom background color as CSS variable on the root element
    const rootStyle = bgColor ? { '--dsh-mp2-bg-color': bgColor } : {}
    return h('div', { ref: rootRef, className: 'dsh-mp2-root', style: rootStyle },

      // ─── Three-zone trigger ───
      h('div', { className: 'dsh-mp2-trigger' + (locked ? ' dsh-mp2-triggerLocked' : '') },

        // LEFT zone: model name (click opens model picker)
        h('button', {
          ref: triggerLeftRef,
          type: 'button',
          className: 'dsh-mp2-triggerLeft',
          title: modelTip,
          'aria-label': modelTip,
          'aria-haspopup': 'menu',
          'aria-expanded': openKind === 'model',
          disabled: locked,
          onClick: () => {
            if (openKind === 'model') { close() } else {
              setOpenKind('model')
              setNotice(null)
              setQuery('')
              lastActionRef.current = 'load'
              reload()
            }
          },
        },
          currentProvider !== null && supplierChip(currentProvider),
          h('span', { className: 'dsh-mp2-triggerLabel' }, modelLabel),
          h('span', { className: 'dsh-mp2-chevron' + (openKind === 'model' ? ' dsh-mp2-chevronOpen' : '') }, icon('chevron', 12)),
        ),

        // Divider
        (effortLabel !== undefined || subagentRoute !== null || sessionId) && h('span', { className: 'dsh-mp2-triggerDivider' }),

        // MIDDLE zone: subagent model (click opens subagent picker)
        sessionId && h('button', {
          ref: triggerSubRef,
          type: 'button',
          className: 'dsh-mp2-triggerSub' + (subagentRoute !== null ? ' dsh-mp2-triggerSubActive' : ''),
          title: t('subagentDesc') + ': ' + (subagentRoute !== null ? subagentRoute.model : t('subagentInherit')),
          'aria-label': t('subagentDesc'),
          'aria-haspopup': 'menu',
          'aria-expanded': openKind === 'subagent',
          disabled: locked,
          onClick: () => {
            if (openKind === 'subagent') { setOpenKind(null) } else {
              setOpenKind('subagent')
              setQuery('')
            }
          },
        },
          icon('building', 14),
        ),

        // Divider
        effortLabel !== undefined && h('span', { className: 'dsh-mp2-triggerDivider' }),

        // RIGHT zone: effort label (click opens effort picker)
        effortLabel !== undefined && h('button', {
          ref: triggerRightRef,
          type: 'button',
          className: 'dsh-mp2-triggerRight',
          title: t('effortHeading') + ': ' + effortLabel,
          'aria-label': t('effortHeading') + ': ' + effortLabel,
          'aria-haspopup': 'menu',
          'aria-expanded': openKind === 'effort',
          disabled: locked,
          onClick: () => {
            if (openKind === 'effort') { setOpenKind(null) } else {
              setOpenKind('effort')
            }
          },
        },
          h('span', null, effortLabel),
          h('span', { className: 'dsh-mp2-chevron' + (openKind === 'effort' ? ' dsh-mp2-chevronOpen' : '') }, icon('chevron', 12)),
        ),
      ),

      // ─── Model picker popup ───
      openKind === 'model' && h('div', {
        className: 'dsh-mp2-menu',
        role: 'menu',
        tabIndex: -1,
        onBlur: onModelBlur,
        onKeyDown: onMenuKeyDown,
        onMouseDown: (event) => { event.preventDefault() },
        'aria-busy': state.status === 'loading' || busy,
      },
        // Search input — always at the top, auto-focused
        h('input', {
          ref: searchRef,
          type: 'text',
          className: 'dsh-mp2-search',
          placeholder: t('search'),
          value: query,
          onChange: (event) => { setQuery(event.target.value) },
          // Focus never leaves the search box, so this is what tells a screen
          // reader which row the arrow keys are standing on.
          'aria-activedescendant': activeAt === -1 ? undefined : optionId(activeAt),
        }),

        // Body: providers (left) + model list (right)
        h('div', { className: 'dsh-mp2-body' },
          // Provider sidebar — caption then the floors.
          h('div', { className: 'dsh-mp2-providers', role: 'tablist', 'aria-label': t('providers') },
            // Column caption: the list itself is "全部供应商", always.
            h('div', { className: 'dsh-mp2-paneCaption' }, t('allProviders')),
            // 常用 floor — most-used models at the top.
            recentRows.length > 0 && h('button', {
              key: RECENT_TAB,
              type: 'button',
              role: 'tab',
              'aria-selected': highlighted === RECENT_TAB,
              className: 'dsh-mp2-provider' + (highlighted === RECENT_TAB ? ' dsh-mp2-providerActive' : ''),
              onClick: () => { scrollToFloor(RECENT_TAB) },
            },
              h('span', { className: 'dsh-mp2-providerName' }, t('recent')),
              h('span', { className: 'dsh-mp2-providerCount' }, String(recentRows.length)),
            ),
            // 收藏 floor — a mirrored copy at the top of the model list.
            h('button', {
              key: FAVORITES_TAB,
              type: 'button',
              role: 'tab',
              'aria-selected': highlighted === FAVORITES_TAB,
              className: 'dsh-mp2-provider' + (highlighted === FAVORITES_TAB ? ' dsh-mp2-providerActive' : ''),
              onClick: () => { scrollToFloor(FAVORITES_TAB) },
            },
              h('span', { className: 'dsh-mp2-providerName' }, t('favorites')),
              h('span', { className: 'dsh-mp2-providerCount' }, String(favoriteRows.length)),
            ),
            // The supplier floors.
            visibleProviders.map((provider) => {
              const active = highlighted === provider.id
              const count = searching ? (matchCounts.get(provider.id) ?? 0) : provider.models.length
              return h('button', {
                key: provider.id,
                type: 'button',
                role: 'tab',
                'aria-selected': active,
                className: 'dsh-mp2-provider' + (active ? ' dsh-mp2-providerActive' : ''),
                onClick: () => { pickProvider(provider.id) },
              },
                supplierChip(provider),
                h('span', { className: 'dsh-mp2-providerName' }, provider.name),
                h('span', { className: 'dsh-mp2-providerCount' }, String(count)),
              )
            }),
          ),

          // Model list
          h('div', { className: 'dsh-mp2-list', ref: listRef, onScroll: onListScroll },
            state.status === 'loading'
              ? h('div', { className: 'dsh-mp2-status' }, t('loading'))
              : h(Fragment, null,
                  state.error !== null && lastActionRef.current === 'load'
                    && h('div', { className: 'dsh-mp2-error' },
                        h('span', null, String(state.error)),
                        h('button', { type: 'button', className: 'dsh-mp2-retry', onClick: reload }, t('retry')),
                      ),
                  notice !== null
                    && h('div', { className: 'dsh-mp2-error' },
                        h('span', null, notice),
                      ),
                  !searching && state.failures.map((failure) =>
                    h('div', { className: 'dsh-mp2-warning', key: failure.id },
                      h('span', null, failure.name + t('loadFailed') + failure.message),
                      h('button', { type: 'button', className: 'dsh-mp2-retry', onClick: reload }, t('retry')),
                    ),
                  ),
                  (grouped === null ? rows.length === 0 : providers.length === 0)
                    ? h('div', { className: 'dsh-mp2-empty' },
                        searching ? t('noMatch') : t('noModels'))
                    : grouped === null
                      ? rows.map(({ group, model, dim }) => {
                          const index = takeRowIndex()
                          const selected = current !== null && current.provider === group.id && current.model === model.id
                          return h(ModelRow, {
                            key: group.id + '/' + model.id,
                            id: optionId(index),
                            group,
                            provider: displayProviderOf(group),
                            model,
                            detail: rowDetail(group, model),
                            selected,
                            active: index === activeAt,
                            busy,
                            favorite: isFavorite(group, model),
                            facts: factsOf(group, model),
                            bridged: VISION_ROUTE.test(group.name),
                            dim,
                            onToggle: () => { toggleFavorite(group, model) },
                            onChoose: () => { choose(group, model) },
                          })
                        })
                      : grouped.map((g) =>
                          h('div', {
                            key: g.id,
                            className: 'dsh-mp2-group',
                            ref: (node) => {
                              if (node === null) groupRefs.current.delete(g.id)
                              else groupRefs.current.set(g.id, node)
                            },
                          },
                            h('div', { className: 'dsh-mp2-groupHeader' },
                              h('span', { className: 'dsh-mp2-groupHeaderIcon' }, icon('building', 14)),
                              h('span', null, g.name),
                            ),
                            g.models.length === 0
                              ? h('div', { className: 'dsh-mp2-empty' },
                                  g.id === FAVORITES_TAB ? t('favoritesEmpty') : t('providerEmpty'))
                              : g.models.map(({ group, model, dim }) => {
                                  const index = takeRowIndex()
                                  const selected = current !== null && current.provider === group.id && current.model === model.id
                                  return h(ModelRow, {
                                    key: group.id + '/' + model.id,
                                    id: optionId(index),
                                    group,
                                    provider: displayProviderOf(group),
                                    model,
                                    detail: g.id === FAVORITES_TAB ? rowDetail(group, model) : model.description,
                                    selected,
                                    active: index === activeAt,
                                    busy,
                                    favorite: isFavorite(group, model),
                                    facts: factsOf(group, model),
                                    bridged: VISION_ROUTE.test(group.name),
                                    dim,
                                    onToggle: () => { toggleFavorite(group, model) },
                                    onChoose: () => { choose(group, model) },
                                  })
                                }),
                          ),
                        ),
                ),
          ),
        ),
      ),

      // ─── Effort picker popup (SEPARATE, standalone) ───
      openKind === 'effort' && EffortPopup({
        reasoning,
        effectiveEffort,
        effortChoices,
        busy,
        chooseEffort,
      }),

      // ─── Subagent model picker popup ───
      openKind === 'subagent' && h(SubagentPopup, {
        sessionId,
        groups: state.groups,
        current: subagentRoute,
        facts,
        busy: subagentBusy,
        onSelect: chooseSubagent,
        onClose: () => setOpenKind(null),
      }),
    )
  }

  // ─── Settings page card ───
  // Rendered by the host settings page through the settings.plugin.item slot.
  // Three sections: the discovery switch, the dim arrivals (ignore/restore),
  // and the catalog models (hide/restore) — the management view of what the
  // picker shows, including dim metadata the selector deliberately does not
  // render. Writes go through the bound settings scope and reach the picker
  // live via its subscription.
  function ModelPickerSettingsCard(props) {
    useLocale()
    const [prefs, setPrefs] = useState(() => readPrefsLocal())
    useEffect(() => {
      const update = () => setPrefs(readPrefsLocal())
      window.addEventListener(PREFS_EVENT, update)
      window.addEventListener('storage', update)
      return () => {
        window.removeEventListener(PREFS_EVENT, update)
        window.removeEventListener('storage', update)
      }
    }, [])
    const [catalog, setCatalog] = useState(null)
    useEffect(() => {
      let live = true
      fetch('/api/model-picker/models', { cache: 'no-store' })
        .then((response) => (response.ok ? response.json() : null))
        .then((body) => { if (live) setCatalog(body) })
        .catch(() => { /* the switch still renders and works offline */ })
      return () => { live = false }
    }, [])
    const [query, setQuery] = useState('')

    const { discovery, ignored: ignoredSet, hidden: hiddenSet } = prefs
    const ignored = [...ignoredSet]
    const hidden = [...hiddenSet]
    const q = query.trim().toLowerCase()

    const discovered = catalog?.discovered ?? []
    const rows = catalog?.rows ?? []
    const visibleDiscovered = discovered
      .filter((d) => q === '' || d.id.toLowerCase().includes(q) || d.name.toLowerCase().includes(q) || d.provider.toLowerCase().includes(q))
    const visibleCatalog = rows
      .filter((row) => {
        if (q === '') return true
        const name = (row.name ?? '').toLowerCase()
        return row.id.toLowerCase().includes(q) || name.includes(q) || row.provider.toLowerCase().includes(q)
      })

    const setDiscovery = () => writePrefs({ discovery: !discovery })
    const addIgnored = (key) => writePrefs({ ignored: [...ignoredSet, key] })
    const addHidden = (key) => writePrefs({ hidden: [...hiddenSet, key] })
    const removeKey = (field, key) => writePrefs({ [field]: [...(field === 'ignored' ? ignoredSet : hiddenSet)].filter((k) => k !== key) })

    const metaOf = (parts) => parts.filter(Boolean).join(' · ')
    const [bgColor, setBgColor] = useState(() => readBgColor())
    const setBg = (color) => {
      writeBgColor(color)
      setBgColor(color)
      window.dispatchEvent(new CustomEvent(PREFS_EVENT))
    }
    return h('div', { className: 'dsh-mp2-set' },
      h('div', { className: 'dsh-mp2-setRow' },
        h('div', null,
          h('div', { className: 'dsh-mp2-setTitle' }, t('setTitle')),
          h('div', { className: 'dsh-mp2-setHint' }, t('setHint')),
        ),
        h('button', {
          type: 'button',
          role: 'switch',
          'aria-checked': discovery,
          'aria-label': t('setTitle'),
          className: 'dsh-mp2-switch' + (discovery ? ' dsh-mp2-switchOn' : ''),
          onClick: setDiscovery,
        }, h('span', { className: 'dsh-mp2-switchKnob' })),
      ),
      // ─── Background color picker ───
      h('div', { className: 'dsh-mp2-setSection' }, t('bgColor')),
      h('div', { className: 'dsh-mp2-bgRow' },
        h('span', { className: 'dsh-mp2-bgLabel' }, t('bgColorDesc')),
        h('input', {
          type: 'color',
          className: 'dsh-mp2-bgInput',
          value: bgColor ?? '#1f2125',
          onChange: (event) => setBg(event.target.value),
        }),
        bgColor !== null && h('button', {
          type: 'button',
          className: 'dsh-mp2-bgReset',
          onClick: () => setBg(null),
        }, t('bgColorDefault')),
      ),
      catalog === null
        ? h('div', { className: 'dsh-mp2-setEmpty' }, t('setLoading'))
        : h(Fragment, null,
          h('div', { className: 'dsh-mp2-setSection' }, t('setDiscovered') + ' · ' + discovered.length),
          visibleDiscovered.length === 0 && h('div', { className: 'dsh-mp2-setEmpty' }, t('setNoneDiscovered')),
          visibleDiscovered.map((d) => {
            const key = d.provider + '/' + d.id
            const isIgnored = ignoredSet.has(key)
            return h('div', { className: 'dsh-mp2-setItem' + (isIgnored ? ' dsh-mp2-setIgnored' : ''), key },
              h('span', { className: 'dsh-mp2-setName' }, d.name),
              h('span', { className: 'dsh-mp2-setMeta' }, metaOf([d.provider, d.released, d.contextWindow !== undefined ? formatContext(d.contextWindow) : null, d.price !== undefined ? '$' + d.price.input + '/$' + d.price.output : null])),
              h('button', {
                type: 'button',
                className: 'dsh-mp2-setBtn',
                onClick: () => (isIgnored ? removeKey('ignored', key) : addIgnored(key)),
              }, isIgnored ? t('setRestore') : t('setIgnore')),
            )
          }),
          h('div', { className: 'dsh-mp2-setSection' }, t('setCatalog') + ' · ' + rows.length),
          h('input', {
            className: 'dsh-mp2-setSearch',
            placeholder: t('setSearch'),
            value: query,
            onInput: (event) => setQuery(event.target.value),
          }),
          hidden.length > 0 && q === '' && h('div', { className: 'dsh-mp2-setEmpty' }, t('setHiddenCount') + hidden.length),
          visibleCatalog.map((row) => {
            const key = row.provider + '/' + row.id
            const isHidden = hiddenSet.has(key)
            return h('div', { className: 'dsh-mp2-setItem' + (isHidden ? ' dsh-mp2-setIgnored' : ''), key },
              h('span', { className: 'dsh-mp2-setName' }, row.name ?? row.id),
              h('span', { className: 'dsh-mp2-setMeta' }, metaOf([row.provider, row.id !== row.name ? row.id : null])),
              h('button', {
                type: 'button',
                className: 'dsh-mp2-setBtn',
                onClick: () => (isHidden ? removeKey('hidden', key) : addHidden(key)),
              }, isHidden ? t('setRestore') : t('setHide')),
            )
          }),
          visibleCatalog.length === 0 && q !== '' && h('div', { className: 'dsh-mp2-setEmpty' }, t('noMatch')),
        ),
    )
  }

  // ─── Plugin registration ───
  // The seat is claimed only once the services it reads are live: an
  // unserviceable occupant would win the single seat and render nothing,
  // hiding the working picker underneath it.
  //
  // `remote` / `remote.session` are required by every face of
  // `modelDirectories`: a cordis service proxy rebinds `this.ctx` to the
  // caller, so `directoryFor()` / `load()` / `select()` read `remote.session`
  // through THIS plugin's inject set. Without them the seat entry throws
  // (`cannot get property "remote.session" without inject`), the shadowing
  // entry abdicates, and the enhanced picker never appears.
  const pluginInject = ['slots', 'sessions', 'modelDirectories', 'remote', 'remote.session']

  function apply(ctx) {
    // Language: follow the DSH environment's language setting. `locale` is a
    // soft dependency — if the locale service is absent the picker keeps the
    // navigator-derived language instead of failing to mount.
    ctx.inject(['locale'], (scope) => {
      const locale = scope.locale
      const sync = () => {
        try { setLocale(locale.getSnapshot().active) } catch (e) {}
      }
      sync()
      ctx.effect(() => locale.subscribe(sync), 'dsh-models-locale')
    })

    // Inject CSS
    ctx.effect(() => {
      const id = 'dsh-models-style'
      if (!document.getElementById(id)) {
        const s = document.createElement('style')
        s.id = id
        s.textContent = CSS
        document.head.appendChild(s)
      }
      return () => { const el = document.getElementById(id); if (el) el.remove() }
    }, 'dsh-models-style')

    // Settings page card. It lands in the family group's "Web 插件" section
    // (web-ui.plugin.item — the seat dsh-web-settings renders; verified
    // visible for external plugins). The alpha.2-removed settings.plugin.item
    // seat has no consumer any more. NOTE: adding a `locale` field here makes
    // the card render INVISIBLE (the section resolves the locale namespace
    // and ours is not a registered family locale) — the card carries its own
    // internal title instead. The card body writes the local preference
    // store; no settings payload crosses the seat.
    {
      try {
        ctx.slots.inject('web-ui.plugin.item', () => ctx.slots.register({
          name: 'web-ui.plugin.item',
          id: SETTINGS_NAMESPACE,
          order: 100,
        }, ModelPickerSettingsCard))
      } catch (error) {
        console.warn('[dsh-models] settings card registration refused:', error)
      }
    }

    // Register into the composer model seat
    ctx.inject(['slots', 'modelDirectories', 'sessions', 'remote', 'remote.session'], (scope) => {
      const slots = scope.slots
      const models = scope.modelDirectories
      const sessions = scope.sessions
      slots.inject('conversation.input.model', () => slots.register({
        name: 'conversation.input.model',
        priority: -20,
        registrant: 'dsh-models',
        inject: (sessionId) => {
          const directory = models.directoryFor(sessionId)
          const available = sessions.subagentAddress(sessionId) === undefined
          return {
            available,
            sessionId,
            directory: directory.store,
            load: () => { if (available) directory.load().catch(() => { /* surfaced on the store */ }) },
            select: (selection) => available
              ? directory.select(selection).then(() => true, () => false)
              : Promise.resolve(false),
          }
        },
      }, ModelPicker))
    })
  }

  module.exports = { inject: pluginInject, apply }
  return module.exports;
} })