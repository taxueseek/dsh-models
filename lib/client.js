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
  const { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, useSyncExternalStore, Fragment } = React
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

  /** Whether a stored route still names a provider+model this catalog serves.
   *  A stored route outlives the providers it points at; restoring a dead one
   *  makes the host reject every subagent request with "no adapter registered". */
  function routeExists(groups, route) {
    for (const group of groups) {
      if (group.id !== route.provider) continue
      return group.models.some((model) => model.id === route.model)
    }
    return false
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
    // The one preference read that must never throw: every other storage
    // reader in this file degrades to defaults when localStorage refuses
    // (private mode, quota), and a throw here would take the picker and the
    // settings card down with it instead of showing defaults.
    let flag = null
    let ignoredRaw = null
    let hiddenRaw = null
    try {
      flag = localStorage.getItem(PREFS_KEYS.discovery)
      ignoredRaw = localStorage.getItem(PREFS_KEYS.ignored)
      hiddenRaw = localStorage.getItem(PREFS_KEYS.hidden)
    } catch { /* storage refused: defaults below */ }
    const list = (raw) => {
      try {
        const parsed = raw === null ? [] : JSON.parse(raw)
        return Array.isArray(parsed) ? new Set(parsed.filter((k) => typeof k === 'string')) : new Set()
      } catch {
        return new Set()
      }
    }
    return { discovery: flag !== '0', ignored: list(ignoredRaw), hidden: list(hiddenRaw) }
  }
  function writePrefs(patch) {
    try {
      if (patch.discovery !== undefined) localStorage.setItem(PREFS_KEYS.discovery, patch.discovery ? '1' : '0')
      if (patch.ignored !== undefined) localStorage.setItem(PREFS_KEYS.ignored, JSON.stringify([...patch.ignored]))
      if (patch.hidden !== undefined) localStorage.setItem(PREFS_KEYS.hidden, JSON.stringify([...patch.hidden]))
    } catch { /* storage refused: preferences stay in-memory for this view */ }
    window.dispatchEvent(new CustomEvent(PREFS_EVENT))
  }

  /** Subscribe to cross-tab storage events + the local PREFS_EVENT broadcast.
   *  Factors out the add/removeEventListener pair every preference surface needs.
   *  The callback is held in a ref so the effect subscribes exactly once:
   *  the callers pass inline arrows, which are new on every render — putting
   *  them in the dependency array would tear down and re-add the listeners
   *  on every render, which is the churn this hook exists to avoid. */
  function usePrefsSync(onChange) {
    const ref = useRef(onChange)
    ref.current = onChange
    useEffect(() => {
      const handler = () => ref.current()
      window.addEventListener(PREFS_EVENT, handler)
      window.addEventListener('storage', handler)
      return () => {
        window.removeEventListener(PREFS_EVENT, handler)
        window.removeEventListener('storage', handler)
      }
    }, [])
  }

  /** A search box that holds its filter back until an IME composition commits.
   *
   *  Chinese, Japanese and Korean input deliver every keystroke of an
   *  in-progress word through onChange, so filtering as they arrive renders
   *  "no match" for a word the user has not finished typing — the list visibly
   *  blanks mid-word. The typed text is always kept (the input stays
   *  controlled and shows what was typed); `committed` only advances once the
   *  composition ends, and that is what the filter reads. A short debounce on
   *  top coalesces fast typing without the composition blink.
   *
   *  @param debounceMs - hold the commit back this long after the last
   *    keystroke; 0 commits as soon as the composition is not in flight.
   *  @returns `{ value, committed, setValue, handoff }` — spread `handoff` onto
   *    the input, filter on `committed`, and use `setValue` for programmatic
   *    changes (clearing the box on close, etc.).
   */
  function useSearchField(debounceMs) {
    const [value, setValue] = useState('')
    const [composing, setComposing] = useState(false)
    const [committed, setCommitted] = useState('')
    useEffect(() => {
      if (composing) return
      if (debounceMs === 0) { setCommitted(value); return }
      const timer = setTimeout(() => setCommitted(value), debounceMs)
      return () => clearTimeout(timer)
    }, [value, composing, debounceMs])
    return {
      value,
      committed,
      setValue,
      handoff: {
        value,
        onChange: (event) => {
          const next = event.target.value
          setValue(next)
          // A zero-debounce box commits in the same commit as the keystroke;
          // routing it through the effect cost one extra render per key.
          if (debounceMs === 0 && !composing) setCommitted(next)
        },
        onCompositionStart: () => { setComposing(true) },
        onCompositionEnd: () => { setComposing(false) },
      },
    }
  }

  /** Snapshot for the seat-less state. Module-level on purpose: it feeds
   *  useSyncExternalStore's getSnapshot, whose identity must stay stable
   *  across renders or the store contract is violated. */
  const EMPTY_STATE = { current: null, routable: null, groups: [], failures: [], status: 'idle', error: null }
  // A shared empty array so the non-searching `rows` keeps a stable identity
  // across renders (a fresh `[]` each render would invalidate flatRows' memo).
  const EMPTY_ROWS = []

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
/* The separator lives on the header, not the group box: a virtual window can
   mount a group's rows without its header (a mid-group slice), and such a run
   must not draw a stray line at the window's top edge. */
.dsh-mp2-group{border-top:none}
.dsh-mp2-groupHeader{position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:5px;padding:10px 8px 4px;border-top:1px solid var(--dsw-alias-border-l1);background-color:var(--dsh-mp2-bg-color, var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base, #1f2125)));background-image:linear-gradient(var(--dsw-specific-menu), var(--dsw-specific-menu));color:var(--dsw-alias-label-tertiary,#999);font-size:11px;line-height:16px;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
/* The very first group on screen draws no separator; once a head spacer is
   mounted the first group is by definition mid-list and keeps its line. */
.dsh-mp2-list>.dsh-mp2-group:first-child .dsh-mp2-groupHeader{border-top:none}
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
/* An unselected row's check slot collapses, so the fact strip gets its 18px and
   only the row actually in use shows a mark column. */
.dsh-mp2-option:not(.dsh-mp2-selected) .dsh-mp2-check{flex-basis:0;width:0}

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
.dsh-mp2-dimtag{flex:0 0 auto;padding:0 5px;border-radius:6px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 16%,transparent);color:var(--dsw-alias-brand-primary);font-size:10px;line-height:14px;font-weight:600;letter-spacing:.02em}
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
    factsPromise = (async () => {
      // The host answers a cold cache with a fast 503 while it warms the
      // catalog in the background, so the first fetch after a restart can come
      // back empty. Retry on that 503 (with back-off) so the badges appear as
      // soon as the refresh lands instead of waiting for a remount; any other
      // status means the route is genuinely absent (older host / non-web
      // carrier) and gives up at once. A give-up still clears the memo so the
      // next mount retries.
      for (let attempt = 0; attempt < 4; attempt++) {
        let response
        try {
          response = await fetch(FACTS_ROUTE, { cache: 'no-store' })
        } catch {
          break
        }
        if (response.ok) {
          const body = await response.json()
          const map = new Map()
          for (const row of body?.rows ?? body?.models ?? []) map.set(row.provider + '/' + row.id, row)
          return { body, map, discovered: Array.isArray(body?.discovered) ? body.discovered : [] }
        }
        if (response.status !== 503) break
        await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)))
      }
      factsPromise = null
      return { body: null, map: new Map(), discovered: [] }
    })()
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

  async function saveSubagentRoute(sessionId, route) {
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
    const entry = { count: (prev?.count || 0) + 1, lastUsed: Date.now() }
    usage.set(key, entry)
    if (usage.size > 200) {
      const sorted = [...usage.entries()].sort((a, b) => (a[1].lastUsed || 0) - (b[1].lastUsed || 0))
      for (const [k] of sorted.slice(0, sorted.length - 200)) usage.delete(k)
    }
    try {
      const obj = {}
      for (const [k, v] of usage) obj[k] = v
      localStorage.setItem(USAGE_KEY, JSON.stringify(obj))
    } catch { /* storage refused */ }
    return entry
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
      onClick: () => { onChoose(group, model) },
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
            onClick: (event) => { event.stopPropagation(); onToggle(group, model) },
            onKeyDown: (event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              event.stopPropagation()
              onToggle(group, model)
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
  const EffortPopup = React.memo(function EffortPopup({ reasoning, effectiveEffort, effortChoices, busy, chooseEffort, close }) {
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
  })

  // ─── Subagent model picker popup ───
  const SubagentPopup = React.memo(function SubagentPopup({ sessionId, groups, current, facts, busy, onSelect, onClose }) {
    // No debounce here: this list is opened deliberately, the popup is small,
    // and the only reason the main picker waits is to coalesce typing bursts.
    // The IME guard still applies.
    const search = useSearchField(0)
    const [activeIndex, setActiveIndex] = useState(0)
    const searchRef = useRef(null)
    const listRef = useRef(null)
    // Same windowing as the main picker: the subagent list is every model of
    // every provider, which is the same 300-row surface.
    const [scrollTop, setScrollTop] = useState(0)
    const [listH, setListH] = useState(0)
    const listHRef = useRef(0)

    const q = search.committed.trim().toLowerCase()
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

    // Row height follows the description line, exactly as the list renders it.
    const layout = useMemo(() => buildFlatLayout(filtered, (group, entry) =>
      entry.model.description !== undefined && entry.model.description !== ''), [filtered])
    const win = useMemo(() => layout.items.length < VIRTUAL_MIN
      ? fullWindow(layout)
      : listWindow(layout, scrollTop, listH > 0 ? listH : VIEWPORT_ESTIMATE),
      [layout, scrollTop, listH])

    // Auto-focus search on open
    useEffect(() => {
      requestAnimationFrame(() => { searchRef.current?.focus() })
    }, [])

    // Reset cursor on new query
    useEffect(() => { setActiveIndex(0) }, [search.committed])

    // The window reads the list's own scroll offset, so adopt it before paint
    // whenever the result set changes; also the first viewport measurement.
    useLayoutEffect(() => {
      const list = listRef.current
      if (list === null) return
      setScrollTop(list.scrollTop)
      const measured = list.clientHeight
      if (measured > 0 && measured !== listHRef.current) {
        listHRef.current = measured
        setListH(measured)
      }
    }, [layout])

    // Keep cursor on screen
    useEffect(() => {
      if (listRef.current === null) return
      ensureRowVisible(layout, listRef.current, activeIndex)
      const node = listRef.current.querySelector('.dsh-mp2-optionActive')
      if (node !== null && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest' })
    }, [activeIndex, filtered.length, layout])

    const onListScroll = (event) => {
      const list = event.currentTarget
      const measured = list.clientHeight
      if (measured > 0 && measured !== listHRef.current) {
        listHRef.current = measured
        setListH(measured)
      }
      const top = list.scrollTop
      const next = listWindow(layout, top, measured > 0 ? measured : VIEWPORT_ESTIMATE)
      const current = listWindow(layout, scrollTop, listHRef.current > 0 ? listHRef.current : VIEWPORT_ESTIMATE)
      if (next.start !== current.start || next.end !== current.end) setScrollTop(top)
    }

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
      const next = Math.min(Math.max(from + delta, 0), count - 1)
      setActiveIndex(next)
      const list = listRef.current
      ensureRowVisible(layout, list, next)
      // Same-commit publish of the new offset: the cursor row mounts with it
      // instead of waiting for the scroll event's frame.
      if (list !== null && layout.items.length >= VIRTUAL_MIN && list.scrollTop !== scrollTop) {
        setScrollTop(list.scrollTop)
      }
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
        ...search.handoff,
      }),
      h('div', { className: 'dsh-mp2-subagentList', ref: listRef, onScroll: onListScroll },
        filtered.length === 0
          ? h('div', { className: 'dsh-mp2-empty' }, searching ? t('noMatch') : t('noModels'))
          : h(Fragment, null,
              win.top > 0 && h('div', { key: 'sp-top', 'aria-hidden': true, style: { height: win.top + 'px' } }),
              layout.items.slice(win.start, win.end).map((item) => {
                const { group, model } = item.entry
                const selected = currentProvider === group.id && currentModelId === model.id
                const modelFacts = facts?.get(group.id + '/' + model.id)
                return h('button', {
                  key: item.key,
                  type: 'button',
                  role: 'menuitemradio',
                  'aria-checked': selected,
                  className: 'dsh-mp2-option' + (selected ? ' dsh-mp2-selected' : '') + (item.fi === activeIndex ? ' dsh-mp2-optionActive' : ''),
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
              layout.total - win.bottom > 0 && h('div', { key: 'sp-bot', 'aria-hidden': true, style: { height: (layout.total - win.bottom) + 'px' } }),
            ),
      ),
      h('div', { className: 'dsh-mp2-subagentHint' },
        h('button', {
          type: 'button',
          className: 'dsh-mp2-setBtn',
          onClick: () => onSelect(null, null),
        }, t('subagentInherit')),
      ),
    )
  })

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

  // ─── Virtualized model list ───
  // The list is one scroll surface holding 300+ rows (310 measured live). Mounting
  // every row costs the opener ~60-140ms and ~5500 DOM nodes — the interaction a
  // user pays most often, since it fires on every model glance and switch. The
  // window below renders only the rows around the viewport (plus overscan) and
  // pads the remainder with two spacer divs, so total height, scrollbar length
  // and every offset stay exact.
  //
  // Heights are NOT measured. `.dsh-mp2-option` is a nowrap one/two-line row, so
  // its height is a pure function of whether it shows a description — likewise
  // the headers and the empty-group note (probed in Chromium against the live
  // DOM: 38 / 50 / 30 / 40). Deterministic heights keep the scroll math free of
  // re-layout, and jsdom — whose clientHeight is always 0 — falls back to
  // rendering everything, which is also what lists below VIRTUAL_MIN get.
  const ROW_H = 38
  const ROW_H_DESC = 50
  const HEADER_H = 30
  const EMPTY_H = 40
  const VIRTUAL_MIN = 60
  const OVERSCAN_PX = 240
  // The menu's height clamp maxes at 400px; estimate from the top of the range
  // so the first render, before the list node exists to measure, still covers
  // the real viewport rather than painting a short window.
  const VIEWPORT_ESTIMATE = 420

  /**
   * Flatten grouped rows into the render layout: one entry per rendered line,
   * in render order. Rows carry `fi` — the index the keyboard cursor and
   * `aria-activedescendant` address them by (identical to the old flatRows
   * order) — plus their top offset and height, so scrolling never reads the DOM.
   * @param groups - display groups (recent / favorites / providers) in order.
   * @param hasDetail - whether a row shows its description line (= its height).
   */
  function buildListLayout(groups, hasDetail) {
    const items = []
    const rows = []
    const rowTop = []
    const rowBottom = []
    const groupNames = new Map()
    let y = 0
    for (const group of groups) {
      groupNames.set(group.id, group.name)
      items.push({ kind: 'header', key: 'h:' + group.id, gid: group.id, name: group.name, h: HEADER_H, top: y })
      y += HEADER_H
      if (group.models.length === 0) {
        items.push({ kind: 'empty', key: 'e:' + group.id, gid: group.id, h: EMPTY_H, top: y })
        y += EMPTY_H
        continue
      }
      for (const entry of group.models) {
        const detail = hasDetail(group, entry)
        const h = detail ? ROW_H_DESC : ROW_H
        items.push({ kind: 'row', key: 'r:' + entry.group.id + '/' + entry.model.id, gid: group.id, entry, fi: rows.length, detail, h, top: y })
        rowTop.push(y)
        rowBottom.push(y + h)
        rows.push(entry)
        y += h
      }
    }
    return { grouped: true, items, rows, rowTop, rowBottom, groupNames, total: y }
  }

  /** The headerless variant for search results and the subagent list. */
  function buildFlatLayout(rows, hasDetail) {
    const items = []
    const rowTop = []
    const rowBottom = []
    let y = 0
    rows.forEach((entry, fi) => {
      const detail = hasDetail(entry.group, entry)
      const h = detail ? ROW_H_DESC : ROW_H
      items.push({ kind: 'row', key: 'r:' + entry.group.id + '/' + entry.model.id, gid: entry.group.id, entry, fi, detail, h, top: y })
      rowTop.push(y)
      rowBottom.push(y + h)
      y += h
    })
    return { grouped: false, items, rows, rowTop, rowBottom, groupNames: new Map(), total: y }
  }

  /** The full-layout window, used before virtualization kicks in. */
  function fullWindow(layout) {
    return { start: 0, end: layout.items.length, top: 0, bottom: layout.total }
  }

  /**
   * The item range covering [scrollTop, scrollTop + viewport] plus overscan.
   * The range is deliberately NOT extended to the owning group's header — that
   * would mount every row between a mid-group scroll position and the header.
   * The pinned section label is a synthetic twin instead (see the render).
   * @returns `{ start, end, top, bottom }` — item range plus spacer heights.
   */
  function listWindow(layout, scrollTop, viewport) {
    const { items } = layout
    const top = Math.max(0, scrollTop - OVERSCAN_PX)
    const bottom = scrollTop + viewport + OVERSCAN_PX
    let start = 0
    while (start < items.length && items[start].top + items[start].h <= top) start++
    let end = start
    while (end < items.length && items[end].top < bottom) end++
    return {
      start,
      end,
      // start === items.length means scrolled past the end: the whole list is
      // above the window, both spacers collapse to the total.
      top: start >= items.length ? layout.total : start === 0 ? 0 : items[start].top,
      bottom: end === items.length ? layout.total : items[end].top,
    }
  }

  /** The group whose header is pinned at `scrollTop` — the elevator's floor.
   *  Same rule the DOM scroll-spy used, computed from layout offsets instead of
   *  reading offsetTop per scroll tick. */
  function spyAt(layout, scrollTop) {
    let current = null
    for (const item of layout.items) {
      if (item.kind !== 'header') continue
      if (item.top > scrollTop + 1) break
      current = item.gid
    }
    return current
  }

  /**
   * Scroll the list just enough to bring row `fi` into view — the virtual
   * replacement for scrollIntoView, which cannot work on a row that is not
   * mounted. The top margin mirrors the CSS scroll-margin so the row lands
   * below the sticky header instead of under it.
   */
  function ensureRowVisible(layout, list, fi) {
    if (list === null || fi < 0 || fi >= layout.rows.length) return
    const rowTop = layout.rowTop[fi]
    const rowBottom = layout.rowBottom[fi]
    let target = list.scrollTop
    if (rowTop < list.scrollTop) target = Math.max(0, rowTop - (HEADER_H + 4))
    else if (rowBottom > list.scrollTop + list.clientHeight) target = rowBottom - list.clientHeight + 4
    if (target !== list.scrollTop) scrollListTo(list, target)
  }

  function scrollListTo(list, top) {
    if (typeof list.scrollTo === 'function') list.scrollTo({ top, behavior: 'auto' })
    else list.scrollTop = top
  }

  // ─── Main component ───
  function ModelPicker(props) {
    const locale = useLocale()
    const locked = props.locked
    const available = props.available
    const directory = props.directory
    const load = props.load
    const select = props.select
    const sessionId = props.sessionId

    // Both arguments are memoized on `directory`: React re-subscribes whenever
    // the subscribe function's identity changes, and inline arrows change on
    // every render — measured 13 subscribe / 12 unsubscribe pairs for eight
    // interactions. Beyond the churn, each unsub/resub window is a gap where a
    // store notification is dropped, so the picker can miss an update it should
    // have shown.
    const subscribeDirectory = useCallback(
      (fn) => (directory === null ? () => { } : directory.subscribe(fn)),
      [directory],
    )
    const getDirectorySnapshot = useCallback(
      () => (directory === null ? EMPTY_STATE : directory.getSnapshot()),
      [directory],
    )
    const state = useSyncExternalStore(subscribeDirectory, getDirectorySnapshot)

    // Which popup is open: null | 'model' | 'effort' | 'subagent'
    const [openKind, setOpenKind] = useState(null)
    // Search box state. The filter itself is free (measured 0.1ms across 276
    // models); rendering the result list is the cost worth coalescing, and even
    // the worst case — a one-character query that matches all 276 rows — renders
    // in 17ms. At 300ms that bought ~12ms of saved render across a seven-key
    // word while adding 210-230ms of visible lag after the last keystroke, so
    // the list sat stale for a fifth of a second on every search. 80ms still
    // coalesces a fast typist's keystrokes and settles within the gap between
    // them, which is what a search-first picker needs. The hook also keeps an
    // IME composition from filtering mid-word.
    const search = useSearchField(80)
    const query = search.value
    const debouncedQuery = search.committed
    // Programmatic clears (close, Escape, pick) go straight to the text state.
    const setQuery = search.setValue
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
    // ─── Subagent model routing ───
    const [subagentRoute, setSubagentRoute] = useState(null)
    const [subagentBusy, setSubagentBusy] = useState(false)
    // The host keeps routes in memory only, so a DSH restart empties every
    // session's route while localStorage still holds what the user chose. Adopt
    // the local copy when the host answers null, and push it back so the host
    // agrees — that is what makes a subagent route survive a restart instead of
    // silently reverting to the main model. A host answer always wins, so a
    // route cleared elsewhere is not resurrected here.
    //
    // A restored route whose provider or model no longer exists is dropped
    // rather than pushed: the host rejects an unknown route with "no adapter
    // registered for provider", so resurrecting it would make every subagent
    // request fail. That check needs the catalog, which arrives asynchronously —
    // hence `groupsReady` in the deps and the one-shot guard, so the adoption
    // still happens exactly once per session.
    const groupsReady = state.groups.length > 0
    const subagentCheckedRef = useRef('')
    useEffect(() => {
      if (!sessionId) return
      // Wait for the catalog before judging a stored route, unless it never
      // arrives (then adopt unvalidated, as before, once the load has settled).
      if (!groupsReady && state.status === 'loading') return
      if (subagentCheckedRef.current === sessionId) return
      subagentCheckedRef.current = sessionId
      let live = true
      void fetchSubagentRoute(sessionId).then(async (route) => {
        if (!live) return
        if (route !== null) { setSubagentRoute(route); return }
        const local = readSubagentRoute(sessionId)
        if (local === null) return
        if (groupsReady && !routeExists(state.groups, local)) {
          // The provider or model is gone. Drop the dead record so it cannot be
          // offered or resurrected again.
          writeSubagentRoute(sessionId, null)
          return
        }
        setSubagentRoute(local)
        await saveSubagentRoute(sessionId, local)
      })
      return () => { live = false }
    }, [sessionId, groupsReady, state.status, state.groups])
    // ─── Custom background color ───
    const [bgColor, setBgColor] = useState(() => readBgColor())
    // One subscription drives both local-preference slices (discovery/ignored/
    // hidden and the picker background): they share the PREFS_EVENT/storage
    // broadcast, so a single listener keeps them in step without a second
    // add/removeEventListener pair re-reading localStorage twice per event.
    usePrefsSync(() => { setPrefs(readPrefsLocal()); setBgColor(readBgColor()) })
    const lastActionRef = useRef('load')
    const rootRef = useRef(null)
    const triggerLeftRef = useRef(null)
    const triggerRightRef = useRef(null)
    const triggerSubRef = useRef(null)
    const searchRef = useRef(null)
    const listRef = useRef(null)
    // The list's viewport height, measured once per open (and re-checked on
    // scroll so a window resize settles). 0 means "not measured yet" and the
    // window renders from the CSS clamp's upper bound instead.
    const [listH, setListH] = useState(0)
    const listHRef = useRef(0)
    // The list's scroll offset, held in state only so the window can re-derive;
    // a scroll that leaves the window unchanged does not set it, so scrolling
    // re-renders the picker a handful of times per gesture, not once per frame.
    const [scrollTop, setScrollTop] = useState(0)

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
        : (reasoning.efforts?.find((level) => level.id === effectiveEffort)?.name ?? String(effectiveEffort))
    const effortChoices = useMemo(() => {
      if (reasoning === undefined) return []
      const rows = []
      if (reasoning.defaultEffort === undefined) {
        rows.push({ key: 'provider-default', effort: undefined, label: t('providerDefault') })
      }
      for (const level of reasoning.efforts ?? []) {
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
    const toggleFavorite = useCallback((group, model) => {
      const key = favoriteKey(group, model)
      const next = new Set(favorites)
      if (!next.delete(key)) next.add(key)
      writeFavorites(next)
      setFavorites(next)
    }, [favorites])
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
    const visibleProviders = useMemo(
      () => searching ? matches.map((item) => item.provider) : providersWithDim,
      [searching, matches, providersWithDim])

    // The right column is one list: the 常用 group (most-used models), then
    // the 收藏 group (a mirrored copy), then every provider group. Searching
    // replaces it with flat results.
    // Usage is read once on mount and updated incrementally in choose() —
    // re-reading the entire localStorage on every favorites change is waste.
    const [usage, setUsage] = useState(() => readUsage())
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

    // Precompute per-provider usage totals: O(n+m) instead of O(n×m)
    const providerUsageMap = useMemo(() => {
      const map = new Map()
      for (const [key, val] of usage) {
        const slash = key.indexOf('/')
        if (slash < 0) continue
        const providerId = key.slice(0, slash)
        map.set(providerId, (map.get(providerId) || 0) + val.count)
      }
      return map
    }, [usage])

    const sortedProviders = useMemo(() => {
      return [...providersWithDim].sort((a, b) => {
        const aCount = providerUsageMap.get(a.id) || 0
        const bCount = providerUsageMap.get(b.id) || 0
        if (aCount !== bCount) return bCount - aCount
        return a.name.localeCompare(b.name)
      })
    }, [providersWithDim, providerUsageMap])

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

    const grouped = useMemo(() => searching
      ? null
      : [
          ...(recentRows.length > 0 ? [{ id: RECENT_TAB, name: t('recent'), models: recentRows }] : []),
          { id: FAVORITES_TAB, name: t('favorites'), models: favoriteRows },
          ...sortedProvidersWithDim,
        ], [searching, recentRows, favoriteRows, sortedProvidersWithDim, locale])
    const rows = searching ? results : EMPTY_ROWS

    // The render layout: headers and rows in order, every offset precomputed.
    // Row height follows the description line — the favorites mirror always
    // shows one (its detail is the serving provider), search results likewise
    // (their detail names the route), so only the plain catalog groups vary.
    const layout = useMemo(() => searching
      ? buildFlatLayout(results, () => true)
      : buildListLayout(grouped, (g, entry) => g.id === FAVORITES_TAB
        || (entry.model.description !== undefined && entry.model.description !== '')),
      [searching, results, grouped])
    // The keyboard cursor is an index into this — identical to the old flat
    // render order, so an empty 收藏 group is skipped rather than standing in
    // the way of the first model.
    const flatRows = layout.rows

    // Window the layout unless it is small enough to mount whole. jsdom's
    // clientHeight is always 0, which lands on the estimate (or below the
    // threshold) and renders everything — tests keep asserting real rows.
    const win = useMemo(() => layout.items.length < VIRTUAL_MIN
      ? fullWindow(layout)
      : listWindow(layout, scrollTop, listH > 0 ? listH : VIEWPORT_ESTIMATE),
      [layout, scrollTop, listH])
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
    // row for the section pinned at the list's top edge. Floors come from the
    // layout's precomputed offsets, so a scroll tick reads no DOM geometry.

    /** Jump the list to a floor. The left column is a table of contents, not a
     *  ride: a supplier click has to land on its group at once, so the scroll is
     *  instant rather than animated. jsdom and older carriers have no `scrollTo`
     *  at all, hence the plain-offset fallback. */
    const scrollToFloor = (id) => {
      for (const item of layout.items) {
        if (item.kind !== 'header' || item.gid !== id) continue
        scrollListTo(listRef.current, item.top)
        setSpyId(id)
        return
      }
    }

    /** Click on a supplier row: a facet while a query is active, else a floor. */
    const pickProvider = (id) => {
      if (searching) {
        setFacetId(facetId === id ? null : id)
        return
      }
      scrollToFloor(id)
    }

    // Throttled scroll handler: one frame per burst, not one per event. It
    // feeds the window (every mode — search results virtualize too) and the
    // spy (grouped mode only, where sections exist).
    const scrollRafRef = useRef(0)
    const onListScroll = (event) => {
      if (scrollRafRef.current !== 0) return
      // Capture the list synchronously: React nulls a synthetic event's
      // currentTarget once dispatch returns, so reading it inside the rAF
      // callback (as this once did) throws and silently kills the spy.
      const list = event.currentTarget
      scrollRafRef.current = requestAnimationFrame(() => {
        scrollRafRef.current = 0
        if (list === null) return
        const top = list.scrollTop
        // Re-measure the viewport here too: a window resize between opens
        // changes the menu's clamped height, and no scroll event announces it.
        const measured = list.clientHeight
        if (measured > 0 && measured !== listHRef.current) {
          listHRef.current = measured
          setListH(measured)
        }
        // Only publish the offset when it moves the window; a scroll inside
        // the same rows must not re-render the picker once per frame.
        const next = listWindow(layout, top, measured > 0 ? measured : VIEWPORT_ESTIMATE)
        const current = listWindow(layout, scrollTop, listHRef.current > 0 ? listHRef.current : VIEWPORT_ESTIMATE)
        if (next.start !== current.start || next.end !== current.end) setScrollTop(top)
        if (!searching) setSpyId(spyAt(layout, top))
      })
    }

    // `load` is held in a ref because the slot seat rebuilds it inside inject(),
    // so its identity is not guaranteed stable across renders. Depending on it
    // directly re-fired this effect on every render — measured 1 load at mount
    // becoming 6 after five renders — and every keystroke, arrow press and
    // scroll tick re-renders the picker. Keying on the session instead keeps the
    // intent (mount, unlock and session switch each trigger a load) without
    // riding a closure identity the seat does not promise.
    const loadRef = useRef(load)
    loadRef.current = load
    useEffect(() => {
      if (!available) return
      lastActionRef.current = 'load'
      loadRef.current()
    }, [available, sessionId])

    // The window reads the list's own scroll offset, so a programmatic scroll
    // (cursor ensure-visible, floor jump) has to be adopted before paint —
    // otherwise the next render derives the window from a stale offset and the
    // list shows the wrong rows for a frame. Also the first measurement of the
    // viewport height once the list node exists.
    useLayoutEffect(() => {
      const list = listRef.current
      if (list === null) return
      setScrollTop(list.scrollTop)
      const measured = list.clientHeight
      if (measured > 0 && measured !== listHRef.current) {
        listHRef.current = measured
        setListH(measured)
      }
    }, [layout, openKind])

    // Model facts are host-wide, not per session: fetch once while mounted.
    useEffect(() => {
      if (!available) return
      let live = true
      loadFacts().then(({ map, discovered }) => {
        if (!live) return
        setFacts(map)
        setDimDiscovered(discovered)
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
    // sticky group header from covering the row it scrolled to; the layout math
    // runs first because the row itself may not be mounted (that is the point
    // of windowing), and the DOM pass covers the mounted case exactly.
    useEffect(() => {
      if (openKind !== 'model') return
      const list = listRef.current
      if (list === null) return
      ensureRowVisible(layout, list, activeAt)
      const node = list.querySelector('.dsh-mp2-optionActive')
      if (node !== null && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest' })
    }, [openKind, activeIndex, query, facetId, flatRows.length, layout])

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

    const close = useCallback((restoreFocus) => {
      setOpenKind(null)
      setNotice(null)
      setFacetId(null)
      setSpyId(null)
      setQuery('')
      if (restoreFocus && triggerLeftRef.current !== null) triggerLeftRef.current.focus()
    }, [])

    const settle = useCallback((accepted) => {
      if (accepted) {
        close(true)
        return
      }
      const message = directory === null ? null : directory.getSnapshot().error
      setNotice(message === null ? t('selectFailed') : t('selectFailedMsg') + message)
    }, [directory, close])

    // --- Select a model ---
    // Stable identity: ModelRow is memoized, so a fresh closure here would
    // re-render every row on each picker render. Deps change only on an actual
    // selection (current) — not on scroll, cursor, or query.
    const choose = useCallback((group, model) => {
      if (current !== null && current.provider === group.id && current.model === model.id) {
        close(true)
        return
      }
      // Persist usage and mirror the same entry into state — the count is
      // computed once, not twice (recordUsage + a separate increment).
      const usageKey = group.id + '/' + model.id
      const usageEntry = recordUsage(group, model)
      setUsage((prev) => {
        const next = new Map(prev)
        next.set(usageKey, usageEntry)
        return next
      })
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
    }, [current, close, select, settle])

    // --- Select reasoning effort independently ---
    const chooseEffort = useCallback((effort) => {
      if (current === null) return
      if (effectiveEffort === effort) return
      lastActionRef.current = 'select'
      const selection = {
        provider: current.provider,
        model: current.model,
        ...(effort === undefined ? {} : { reasoningEffort: effort }),
      }
      void select(selection).then(settle)
    }, [current, effectiveEffort, select, settle])

    // --- Select subagent model ---
    // `saveSubagentRoute` (module) is deliberately NOT named `setSubagentRoute`:
    // the component's own useState setter carries that name and would shadow it,
    // so the POST would silently target the setter (a no-op returning undefined)
    // and `.then` would throw — the subagent pick would never persist.
    const chooseSubagent = useCallback((group, model) => {
      if (!sessionId) return
      setSubagentBusy(true)
      const route = group === null ? null : {
        provider: group.id,
        model: model.id,
        ...(model.reasoning?.defaultEffort !== undefined ? { reasoningEffort: model.reasoning.defaultEffort } : {}),
      }
      void saveSubagentRoute(sessionId, route).then((ok) => {
        if (ok) {
          writeSubagentRoute(sessionId, route)
          setSubagentRoute(route)
          setOpenKind(null)
        }
        setSubagentBusy(false)
      })
    }, [sessionId])

    // Stable no-arg closer for the subagent popup's memo to key on.
    const closeSubagent = useCallback(() => setOpenKind(null), [])

    // --- Keyboard ---
    // The whole popup is drivable from the search box: ↑/↓ walk the list, Enter
    // commits the row the cursor is on. Focus stays in the input, so the cursor
    // is reported to assistive tech through `aria-activedescendant` rather than
    // by moving DOM focus — typing keeps filtering after every arrow press.
    /**
     * Move the keyboard cursor and bring its row into the window in one commit.
     * `ensureRowVisible` moves the list's scrollTop synchronously; publishing
     * that offset in the same commit means the row is mounted immediately, so
     * `aria-activedescendant` never names a missing id for a frame (a browser
     * would chase it with a scroll event one frame later anyway — this just
     * closes the gap). Below the virtual threshold the offset is irrelevant.
     */
    const followCursor = (fi) => {
      const list = listRef.current
      ensureRowVisible(layout, list, fi)
      if (list !== null && layout.items.length >= VIRTUAL_MIN && list.scrollTop !== scrollTop) {
        setScrollTop(list.scrollTop)
      }
    }

    const moveCursor = (delta) => {
      const count = flatRows.length
      if (count === 0) return
      const from = activeAt === -1 ? 0 : activeAt
      const next = Math.min(Math.max(from + delta, 0), count - 1)
      setActiveIndex(next)
      followCursor(next)
    }

    const onMenuKeyDown = (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      switch (event.key) {
        case 'ArrowDown': event.preventDefault(); moveCursor(1); break
        case 'ArrowUp': event.preventDefault(); moveCursor(-1); break
        case 'Home': event.preventDefault(); setActiveIndex(0); followCursor(0); break
        case 'End': {
          event.preventDefault()
          const last = flatRows.length - 1
          setActiveIndex(last)
          followCursor(last)
          break
        }
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

    // Rows are numbered by their layout index — exactly `flatRows` order — so
    // the cursor can address one by index and the search box can name it in
    // `aria-activedescendant`. Numbering by position rather than by route keeps
    // the two copies of a favorited model — the 收藏 mirror and the row under
    // its supplier — from lighting up together.
    const renderRow = (item) => {
      const { group, model, dim } = item.entry
      const selected = current !== null && current.provider === group.id && current.model === model.id
      return h(ModelRow, {
        key: item.key,
        id: optionId(item.fi),
        group,
        provider: displayProviderOf(group),
        model,
        detail: layout.grouped
          ? (item.gid === FAVORITES_TAB ? rowDetail(group, model) : model.description)
          : rowDetail(group, model),
        selected,
        active: item.fi === activeAt,
        busy,
        favorite: isFavorite(group, model),
        facts: factsOf(group, model),
        bridged: VISION_ROUTE.test(group.name),
        dim,
        onToggle: toggleFavorite,
        onChoose: choose,
      })
    }

    // The window is a contiguous slice of the layout; split it into group runs
    // by each row's own group id, so a slice that starts mid-group still gets
    // its rows (its header is the synthetic pinned one below, not an in-slice
    // header). `hasHeader` records whether the group's real header is mounted.
    const groupRuns = []
    const runOfGid = new Map()
    for (let i = win.start; i < win.end; i++) {
      const item = layout.items[i]
      let run = runOfGid.get(item.gid)
      if (run === undefined) {
        run = { key: 'g:' + item.gid, gid: item.gid, name: layout.groupNames.get(item.gid) ?? '', items: [], hasHeader: false }
        runOfGid.set(item.gid, run)
        groupRuns.push(run)
      }
      if (item.kind === 'header') run.hasHeader = true
      else run.items.push(item)
    }

    // The pinned section label. While a group's real header is mounted (on
    // screen, sticky as ever) it does the pinning; once the header scrolls
    // above the viewport, its rows would otherwise lose their section label,
    // so a twin mounts at the top of the window and sticks there — the same
    // element the browser would keep pinned if every row were mounted. The
    // next group's real header paints over it as it arrives (later in DOM).
    const floorGroup = layout.grouped && !searching ? spyAt(layout, scrollTop) : null
    const pinnedHeader = (() => {
      if (floorGroup === null) return null
      let headerTop = null
      let headerName = null
      for (const item of layout.items) {
        if (item.kind !== 'header' || item.gid !== floorGroup) continue
        headerTop = item.top
        headerName = item.name
        break
      }
      // Real header still inside the window: it pins on its own.
      if (headerTop === null || headerTop >= scrollTop) return null
      if (win.start < win.end && layout.items.slice(win.start, win.end)
        .some((item) => item.kind === 'header' && item.gid === floorGroup)) return null
      return h('div', { key: 'pinned:' + floorGroup, className: 'dsh-mp2-groupHeader' },
        h('span', { className: 'dsh-mp2-groupHeaderIcon' }, icon('building', 14)),
        h('span', null, headerName),
      )
    })()

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
          ...search.handoff,
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
                  (searching ? rows.length === 0 : providers.length === 0)
                    ? h('div', { className: 'dsh-mp2-empty' },
                        searching ? t('noMatch') : t('noModels'))
                    : h(Fragment, null,
                        // The two spacers stand in for the scrolled-away rows:
                        // total height, scrollbar length and every offset the
                        // window math uses stay exactly the full list's.
                        win.top > 0 && h('div', { key: 'sp-top', 'aria-hidden': true, style: { height: win.top + 'px' } }),
                        pinnedHeader,
                        layout.grouped
                          ? groupRuns.map((run) =>
                              h('div', { key: run.key, className: 'dsh-mp2-group' },
                                run.hasHeader && h('div', { className: 'dsh-mp2-groupHeader' },
                                  h('span', { className: 'dsh-mp2-groupHeaderIcon' }, icon('building', 14)),
                                  h('span', null, run.name),
                                ),
                                run.items.map((item) => item.kind === 'empty'
                                  ? h('div', { key: item.key, className: 'dsh-mp2-empty' },
                                      item.gid === FAVORITES_TAB ? t('favoritesEmpty') : t('providerEmpty'))
                                  : renderRow(item)),
                              ),
                            )
                          : layout.items.slice(win.start, win.end).map(renderRow),
                        layout.total - win.bottom > 0 && h('div', { key: 'sp-bot', 'aria-hidden': true, style: { height: (layout.total - win.bottom) + 'px' } }),
                      ),
                ),
          ),
        ),
      ),

      // ─── Effort picker popup (SEPARATE, standalone) ───
      openKind === 'effort' && h(EffortPopup, {
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
        onClose: closeSubagent,
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
    usePrefsSync(() => setPrefs(readPrefsLocal()))
    const [catalog, setCatalog] = useState(null)
    useEffect(() => {
      let live = true
      // Same endpoint the picker fetches — share the memoized request so the
      // settings page and the picker never issue two concurrent fetches.
      loadFacts().then(({ body }) => { if (live) setCatalog(body) })
      return () => { live = false }
    }, [])
    // Same instant-filter treatment as the pickers: no debounce (the catalog
    // list is short), but an in-flight IME composition must not filter.
    const search = useSearchField(0)

    const { discovery, ignored: ignoredSet, hidden: hiddenSet } = prefs
    const ignored = [...ignoredSet]
    const hidden = [...hiddenSet]
    const q = search.committed.trim().toLowerCase()

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
            ...search.handoff,
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