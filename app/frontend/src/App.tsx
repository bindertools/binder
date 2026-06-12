import React, { useReducer, useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from 'react'
import Terminal from './components/Terminal'
import Editor from './components/Editor'
import Database from './components/Database'
import Preview from './components/Preview'
import Problems, { type CweItem } from './components/Problems'
import ConfigEditor from './components/ConfigEditor'
import ZoomIndicator from './components/ZoomIndicator'
import SearchPalette from './components/SearchPalette'
import SplitPaneView from './components/SplitPaneView'
import PaneTabBar from './components/PaneTabBar'
import Sidebar, { type PageId } from './components/Sidebar'
import DatabasePage from './components/DatabasePage'
import PortsTab from './components/PortsTab'
import VersionControlPanel from './components/VersionControlPanel'
import NotepadPage from './components/NotepadPage'
import WorkflowsPanel from './components/WorkflowsPanel'
import WorkflowRunToasts from './components/WorkflowRunToasts'
import PerfTab from './components/PerfTab'
import PluginStore from './plugins/PluginStore'
import FullscreenIDE from './fullscreen/FullscreenIDE'
import {
  buildInstalledPluginCommandMap, loadInstalledPlugins, bootstrapBuiltins,
  type InstalledPluginCommand, type Plugin, type PluginContext,
} from './plugins'
import { Tab, ProbItem, OpenFilePayload, OpenDatabasePayload, OpenPreviewPayload, OpenProblemsPayload, AppConfig } from './types'
import {
  createLeaf, splitPaneInTree, closePaneInTree, addTabToLeaf, removeTabFromTree,
  updateLeafInTree, updateRatioInTree, findLeaf, getAllLeaves, getFirstLeaf,
  clearLinkedTerminalInTree,
  type PaneNode, type LeafPane,
} from './paneModel'
import { EventsOn, EventsOff, Quit, WindowMinimise, WindowToggleMaximise } from '../wailsjs/runtime/runtime'
import {
  GetAppConfig, SaveSession, LoadSession, ReadFile, GetFileLanguage, GetTerminalCwd,
  ScanProblems, ScanCWE, SaveCustomTheme, SaveAppConfig, CheckForUpdate, PerformUpdate,
} from '../wailsjs/go/main/App'
import { useDragRegions } from './lib/useDragRegions'
import { useShortcuts, loadKeybindings, saveKeybindings, type ShortcutHandlers } from './lib/useShortcuts'
import { getTheme, customColorsToTheme } from './themes'
import './App.css'

// ── Pane layout math (mirrors SplitPaneView constants) ───────────────────────
const PANE_DIVIDER_PX = 4

interface PaneContentRect { x: number; y: number; w: number; h: number }

function getPaneContentRect(
  node: PaneNode,
  targetPaneId: string,
  x: number, y: number, w: number, h: number,
): PaneContentRect | null {
  if (node.type === 'leaf') {
    if (node.id !== targetPaneId) return null
    return { x, y, w, h }
  }
  const isH = node.direction === 'h'
  const f = isH ? w * node.ratio - PANE_DIVIDER_PX / 2 : h * node.ratio - PANE_DIVIDER_PX / 2
  const s = isH ? w * (1 - node.ratio) - PANE_DIVIDER_PX / 2 : h * (1 - node.ratio) - PANE_DIVIDER_PX / 2
  return isH
    ? (getPaneContentRect(node.first, targetPaneId, x, y, f, h) ?? getPaneContentRect(node.second, targetPaneId, x + f + PANE_DIVIDER_PX, y, s, h))
    : (getPaneContentRect(node.first, targetPaneId, x, y, w, f) ?? getPaneContentRect(node.second, targetPaneId, x, y + f + PANE_DIVIDER_PX, w, s))
}

let tabCounter = 0
const SESSION_TS = Date.now()
const nextId = () => `tab-${SESSION_TS}-${++tabCounter}`

// ── Recent paths helpers ──────────────────────────────────────────────────────

const RECENT_PATHS_KEY = 'cmdide_recent_paths'

function loadRecentPaths(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_PATHS_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch { return [] }
}

const RECENT_PATHS_LIMIT = 5

function saveRecentPath(newPath: string): string[] {
  try {
    const current = loadRecentPaths().filter(p => p !== newPath)
    const next = [newPath, ...current].slice(0, RECENT_PATHS_LIMIT)
    localStorage.setItem(RECENT_PATHS_KEY, JSON.stringify(next))
    return next
  } catch { return loadRecentPaths() }
}

function makeTerminalTab(id?: string, initialCwd?: string, parentId?: string): Tab {
  return {
    id: id ?? nextId(),
    type: 'terminal',
    title: 'terminal',
    ...(initialCwd ? { initialCwd } : {}),
    ...(parentId   ? { parentId }   : {}),
  }
}

// ── Per-tab pane layouts ──────────────────────────────────────────────────────
// Every top-level tab (no parentId) owns its own independent pane-layout tree.
// Pages/secondary terminals (parentId set) live inside their owning top-level
// tab's tree. This keeps tabs from ever sharing or leaking into each other's panes.

interface Layout { root: PaneNode; focusedPaneId: string }

function workspaceIdOf(tabId: string, tabs: Tab[]): string {
  let cur = tabs.find(t => t.id === tabId)
  const seen = new Set<string>()
  while (cur?.parentId && !seen.has(cur.id)) {
    seen.add(cur.id)
    const parent = tabs.find(t => t.id === cur!.parentId)
    if (!parent) break
    cur = parent
  }
  return cur?.id ?? tabId
}

// The terminal a pane's editor/sidebar pages are tied to (for cwd lookups, etc.)
function getPaneTerminalId(pane: LeafPane, tabs: Tab[]): string | null {
  const paneTabs = pane.tabIds.map(id => tabs.find(t => t.id === id)).filter((t): t is Tab => t !== undefined)
  const activeTab = paneTabs.find(t => t.id === pane.activeTabId)
  return (activeTab?.type === 'terminal' ? activeTab.id : null)
    ?? paneTabs.find(t => t.type === 'terminal')?.id
    ?? pane.linkedTerminalId
    ?? null
}

// ── Tab reducer ───────────────────────────────────────────────────────────────

type TabState = { tabs: Tab[]; activeId: string }
type TabAction =
  | { type: 'add-terminal';    id?: string; initialCwd?: string; parentId?: string; keepActive?: boolean }
  | { type: 'open-file';       payload: OpenFilePayload }
  | { type: 'open-database';   payload: OpenDatabasePayload }
  | { type: 'open-preview';    payload: OpenPreviewPayload }
  | { type: 'open-problems';   payload: OpenProblemsPayload }
  | { type: 'open-config';     terminalId?: string }
  | { type: 'open-tab';        tabType: string; title: string; terminalId?: string; cwd?: string }
  | { type: 'update-problems'; id: string; sources: string[]; items: ProbItem[]; scanning?: boolean }
  | { type: 'rename-tab';      id: string; title: string }
  | { type: 'set-tab-color';   id: string; color: string | null }
  | { type: 'close';           id: string }
  | { type: 'select';          id: string }
  | { type: 'restore-session'; tabs: Tab[] }
  | { type: 'set-tab-page';   id: string; page: PageId }

function tabReducer(state: TabState, action: TabAction): TabState {
  switch (action.type) {

    case 'add-terminal': {
      const tab = makeTerminalTab(action.id, action.initialCwd, action.parentId)
      const newTabs = [...state.tabs]
      if (action.parentId) {
        let insertIdx = newTabs.length
        for (let i = newTabs.length - 1; i >= 0; i--) {
          if (newTabs[i].id === action.parentId || newTabs[i].parentId === action.parentId) {
            insertIdx = i + 1; break
          }
        }
        newTabs.splice(insertIdx, 0, tab)
      } else {
        newTabs.push(tab)
      }
      return { tabs: newTabs, activeId: action.keepActive ? state.activeId : tab.id }
    }

    case 'open-file': {
      const { payload } = action
      const existing = state.tabs.find(t => t.type === 'editor' && t.filePath === payload.path)
      if (existing) {
        return {
          ...state, activeId: existing.id,
          tabs: payload.gotoLine
            ? state.tabs.map(t => t.id === existing.id ? { ...t, gotoLine: payload.gotoLine } : t)
            : state.tabs,
        }
      }
      const fileName = payload.path.replace(/\\/g, '/').split('/').pop() ?? payload.path
      const tab: Tab = {
        id: nextId(), type: 'editor', title: fileName,
        filePath: payload.path, content: payload.content,
        language: payload.language, parentId: payload.terminalId,
        gotoLine: payload.gotoLine,
      }
      return insertNearParent(state, tab, payload.terminalId)
    }

    case 'open-database': {
      const { payload } = action
      const existing = state.tabs.find(t => t.type === 'database' && t.dbPath === payload.path)
      if (existing) return { ...state, activeId: existing.id }
      const fileName = payload.path.replace(/\\/g, '/').split('/').pop() ?? payload.path
      const tab: Tab = { id: nextId(), type: 'database', title: fileName, dbPath: payload.path, parentId: payload.terminalId }
      return insertNearParent(state, tab, payload.terminalId)
    }

    case 'open-preview': {
      const { payload } = action
      const previewKey = payload.type === 'url' ? payload.url! : payload.path!
      const existing = state.tabs.find(t => t.type === 'preview' && t.previewPath === previewKey)
      if (existing) return { ...state, activeId: existing.id }
      const title = previewKey.replace(/\\/g, '/').split('/').pop() ?? previewKey
      const previewSrc = payload.type === 'url' ? payload.url! : (payload.url ?? payload.content ?? '')
      const tab: Tab = {
        id: nextId(), type: 'preview', title,
        previewType: payload.type, previewSrc, previewPath: previewKey, parentId: payload.terminalId,
      }
      return insertNearParent(state, tab, payload.terminalId)
    }

    case 'open-problems': {
      const { payload } = action
      const existing = state.tabs.find(t => t.type === 'debug' && t.problemsCwd === payload.cwd)
      if (existing) {
        return {
          ...state, activeId: existing.id,
          tabs: state.tabs.map(t => t.id === existing.id
            ? { ...t, problemsSources: payload.sources, problemsItems: payload.items } : t),
        }
      }
      const tab: Tab = {
        id: nextId(), type: 'debug', title: 'Debug', parentId: payload.terminalId,
        problemsCwd: payload.cwd, problemsSources: payload.sources, problemsItems: payload.items,
      }
      return insertNearParent(state, tab, payload.terminalId)
    }

    case 'open-config': {
      const existing = state.tabs.find(t => t.type === 'config')
      if (existing) return { ...state, activeId: existing.id }
      return insertNearParent(state, { id: nextId(), type: 'config', title: 'Settings', parentId: action.terminalId }, action.terminalId)
    }

    case 'open-tab': {
      if (action.tabType !== 'fullscreen') {
        const existing = state.tabs.find(t => t.type === action.tabType)
        if (existing) return { ...state, activeId: existing.id }
      }
      const tab: Tab = {
        id: nextId(), type: action.tabType as Tab['type'], title: action.title,
        parentId: action.terminalId,
        ...(action.cwd ? { meta: { cwd: action.cwd } } : {}),
      }
      return insertNearParent(state, tab, action.terminalId)
    }

    case 'update-problems':
      return {
        ...state,
        tabs: state.tabs.map(t => t.id === action.id
          ? { ...t, problemsSources: action.sources, problemsItems: action.items } : t),
      }

    case 'rename-tab': {
      const title = action.title.trim()
      if (!title) return state
      return { ...state, tabs: state.tabs.map(t => t.id === action.id ? { ...t, title } : t) }
    }

    case 'set-tab-color':
      return { ...state, tabs: state.tabs.map(t => t.id === action.id ? { ...t, color: action.color ?? undefined } : t) }

    case 'close': {
      const closingTab = state.tabs.find(t => t.id === action.id)
      if (!closingTab) return state
      // Cascade-close all child tabs (pages opened from this terminal)
      const idsToClose = new Set([action.id])
      if (closingTab.type === 'terminal') {
        state.tabs.forEach(t => { if (t.parentId === action.id) idsToClose.add(t.id) })
      }
      const newTabs = state.tabs.filter(t => !idsToClose.has(t.id))
      if (newTabs.length === 0) return state
      const idx = state.tabs.findIndex(t => t.id === action.id)
      return {
        tabs: newTabs,
        activeId: idsToClose.has(state.activeId)
          ? newTabs[Math.min(idx, newTabs.length - 1)].id
          : state.activeId,
      }
    }

    case 'set-tab-page':
      return { ...state, tabs: state.tabs.map(t => t.id === action.id ? { ...t, activePage: action.page } : t) }

    case 'select':
      return { ...state, activeId: action.id }

    case 'restore-session':
      if (action.tabs.length === 0) return state
      return { tabs: action.tabs, activeId: action.tabs[action.tabs.length - 1].id }

    default:
      return state
  }
}

function insertNearParent(state: TabState, tab: Tab, terminalId?: string): TabState {
  const newTabs = [...state.tabs]
  if (terminalId) {
    let insertIdx = newTabs.length
    for (let i = newTabs.length - 1; i >= 0; i--) {
      if (newTabs[i].id === terminalId || newTabs[i].parentId === terminalId) {
        insertIdx = i + 1; break
      }
    }
    newTabs.splice(insertIdx, 0, tab)
  } else {
    newTabs.push(tab)
  }
  return { tabs: newTabs, activeId: tab.id }
}

// ── Default config ────────────────────────────────────────────────────────────

const defaultConfig: AppConfig = {
  default_directory: '', indent_guides: false, order_directory: false,
  minimap: false, theme: 'dark', show_timestamps: false,
  git_recognition: { show_git_branch: false }, soft_close: false,
  zoom_insights: true, minimal_pwd: false, default_zoom: 1, command_alignment: 'default',
  terminal_word_wrap: false, file_word_wrap: false, scroll_speed: 1,
  preferred_shell: '', database_privacy: false,
}

const LAYOUT_STORAGE_KEY = 'cmdide_pane_layout_v2'

// ── Layout persistence helpers ────────────────────────────────────────────────
// Layouts are stored using tab-array INDICES (not IDs) so they survive
// session restores that generate fresh tab IDs.

function saveLayoutToStorage(layouts: Record<string, Layout>, tabs: Tab[], activeWorkspaceId: string) {
  try {
    const idxOf = new Map(tabs.map((t, i) => [t.id, i]))
    function ser(node: PaneNode): unknown {
      if (node.type === 'leaf') {
        const ii = node.tabIds.map(id => idxOf.get(id) ?? -1).filter(i => i >= 0)
        const ai = idxOf.get(node.activeTabId) ?? 0
        return { t: 'l', id: node.id, ii, ai, pg: node.activePage }
      }
      return { t: 's', id: node.id, dir: node.direction, r: node.ratio,
               a: ser(node.first), b: ser(node.second) }
    }
    const workspaces = Object.entries(layouts)
      .map(([workspaceId, layout]) => {
        const ti = idxOf.get(workspaceId)
        if (ti === undefined) return null
        return { ti, tree: ser(layout.root), fid: layout.focusedPaneId }
      })
      .filter((w): w is { ti: number; tree: unknown; fid: string } => w !== null)
    const activeTi = idxOf.get(activeWorkspaceId) ?? 0
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ workspaces, activeTi }))
  } catch { /* ignore */ }
}

function restoreLayoutFromStorage(tabs: Tab[]): { layouts: Record<string, Layout>; activeWorkspaceId: string } | null {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY)
    if (!raw) return null
    const { workspaces, activeTi } = JSON.parse(raw) as {
      workspaces?: { ti: number; tree: unknown; fid: string }[]
      activeTi?: number
    }
    function des(node: { t: string; id: string; ii?: number[]; ai?: number; pg?: string; dir?: 'h' | 'v'; r?: number; a?: unknown; b?: unknown }): PaneNode | null {
      if (node.t === 'l') {
        const tabIds = (node.ii ?? []).filter(i => i >= 0 && i < tabs.length).map(i => tabs[i].id)
        if (tabIds.length === 0) return null
        const ai = node.ai ?? 0
        const activeTabId = ai >= 0 && ai < tabs.length ? tabs[ai].id : tabIds[0]
        return { type: 'leaf', id: node.id, tabIds, activeTabId, activePage: (node.pg ?? 'terminal') as LeafPane['activePage'] }
      }
      if (!node.a || !node.b) return null
      const first  = des(node.a as typeof node)
      const second = des(node.b as typeof node)
      if (!first && !second) return null
      if (!first)  return second!
      if (!second) return first
      return { type: 'split', id: node.id, direction: node.dir!, ratio: node.r ?? 0.5, first, second }
    }
    const layouts: Record<string, Layout> = {}
    for (const w of workspaces ?? []) {
      const workspaceTab = tabs[w.ti]
      if (!workspaceTab || workspaceTab.parentId) continue
      const root = des(w.tree as Parameters<typeof des>[0])
      if (!root) continue
      const focusedPaneId = w.fid && findLeaf(root, w.fid) ? w.fid : getFirstLeaf(root).id
      layouts[workspaceTab.id] = { root, focusedPaneId }
    }
    if (Object.keys(layouts).length === 0) return null
    const activeTab = activeTi !== undefined ? tabs[activeTi] : undefined
    const activeWorkspaceId = (activeTab && layouts[activeTab.id]) ? activeTab.id : Object.keys(layouts)[0]
    return { layouts, activeWorkspaceId }
  } catch { return null }
}

const initialTab  = makeTerminalTab()
const initialLeaf = createLeaf([initialTab.id], initialTab.id)
const initialState: TabState = { tabs: [initialTab], activeId: initialTab.id }

// ── PluginErrorBoundary ───────────────────────────────────────────────────────

class PluginErrorBoundary extends React.Component<
  { pluginName: string; children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error) { console.error(`[plugins] ${this.props.pluginName} crashed`, error) }
  render() {
    if (this.state.error) {
      return (
        <div className="h-full flex items-center justify-center p-6 bg-[var(--app-bg)]">
          <div className="max-w-[720px] w-full border border-sep rounded-[18px] p-5 bg-[rgba(255,255,255,0.03)] text-[var(--tab-color)] font-mono">
            <div className="text-[12px] tracking-[0.12em] uppercase opacity-60 mb-2">Plugin Error</div>
            <div className="text-[18px] font-bold mb-2.5">{this.props.pluginName} failed to render</div>
            <div className="text-[12px] leading-[1.7] opacity-[0.82] whitespace-pre-wrap">
              {(this.state.error as Error).message}
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [state, dispatch] = useReducer(tabReducer, initialState)
  const { tabs } = state

  useDragRegions()

  // ── Per-tab pane layouts ──────────────────────────────────────────────────────
  const [layouts, setLayouts] = useState<Record<string, Layout>>({
    [initialTab.id]: { root: initialLeaf, focusedPaneId: initialLeaf.id },
  })

  const activeWorkspaceId = useMemo(() => workspaceIdOf(state.activeId, tabs), [state.activeId, tabs])
  const activeLayout: Layout = useMemo(
    () => layouts[activeWorkspaceId] ?? Object.values(layouts)[0] ?? { root: initialLeaf, focusedPaneId: initialLeaf.id },
    [layouts, activeWorkspaceId],
  )

  // ── Every leaf pane across every workspace, with its owning workspace id ─────
  const allLeavesWithWs = useMemo(
    () => Object.entries(layouts).flatMap(([wsId, l]) => getAllLeaves(l.root).map(leaf => ({ wsId, leaf }))),
    [layouts],
  )

  // ── Leaves that have ever shown the editor page ──────────────────────────────
  // Sticky set: once a pane opens the Code Editor, its FullscreenIDE instance is
  // kept mounted (in an overlay, like terminals) so explorer/open-files/cursor
  // state survives switching pages or tabs and back.
  const editorLeafIdsRef = useRef<Set<string>>(new Set())
  const editorLeafIds = useMemo(() => {
    const currentIds = new Set(allLeavesWithWs.map(({ leaf }) => leaf.id))
    for (const { leaf } of allLeavesWithWs) {
      if (leaf.activePage === 'editor') editorLeafIdsRef.current.add(leaf.id)
    }
    for (const id of editorLeafIdsRef.current) {
      if (!currentIds.has(id)) editorLeafIdsRef.current.delete(id)
    }
    return [...editorLeafIdsRef.current]
  }, [allLeavesWithWs])

  const updateLayout = useCallback((workspaceId: string, fn: (l: Layout) => Layout) => {
    setLayouts(prev => {
      const cur = prev[workspaceId]
      return cur ? { ...prev, [workspaceId]: fn(cur) } : prev
    })
  }, [])

  // ── Pane content area for terminal overlay ───────────────────────────────────
  const contentAreaRef                    = useRef<HTMLDivElement>(null)
  const [contentAreaSize, setContentAreaSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 })

  useLayoutEffect(() => {
    const el = contentAreaRef.current
    if (!el) return
    setContentAreaSize({ w: el.offsetWidth, h: el.offsetHeight })
    const ro = new ResizeObserver(() => setContentAreaSize({ w: el.offsetWidth, h: el.offsetHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ── General state ────────────────────────────────────────────────────────────
  const [pageDrag,  setPageDrag]  = useState<{ page: PageId } | null>(null)
  const [dropEdge,  setDropEdge]  = useState<'up' | 'down' | 'left' | 'right' | null>(null)

  const [searchOpen,     setSearchOpen]     = useState(false)
  const [terminalCwds,   setTerminalCwds]   = useState<Record<string, string>>({})
  const [forcedDbPath,   setForcedDbPath]   = useState<string | undefined>()
  const [plugins,        setPlugins]        = useState<Record<string, Plugin>>({})
  const [pluginCommands, setPluginCommands] = useState<Record<string, InstalledPluginCommand>>({})
  const [recentPaths,    setRecentPaths]    = useState<string[]>(loadRecentPaths)

  const pathDwellRef = useRef<Map<string, { path: string; enteredAt: number; relatedPageVisited: boolean }>>(new Map())

  // ── Plugin loader ─────────────────────────────────────────────────────────────
  const reloadPlugins = useCallback(async () => {
    if (!__PLUGINS__) return
    bootstrapBuiltins()
    const loaded = await loadInstalledPlugins().catch(() => [] as Plugin[])
    const map: Record<string, Plugin> = {}
    for (const p of loaded) { if (p.tabType) map[p.tabType] = p }
    setPlugins(map)
    setPluginCommands(buildInstalledPluginCommandMap(loaded))
  }, [])

  useEffect(() => { void reloadPlugins() }, [reloadPlugins])

  // ── App config ───────────────────────────────────────────────────────────────
  const [appConfig,   setAppConfig]   = useState<AppConfig>(defaultConfig)
  const [currentZoom, setCurrentZoom] = useState(() => {
    const saved = parseFloat(localStorage.getItem('cmdide_zoom') ?? '')
    return isFinite(saved) && saved > 0 ? saved : defaultConfig.default_zoom
  })
  const [liveColors,      setLiveColors]      = useState<Record<string, string> | null>(null)
  const [updateTag,       setUpdateTag]       = useState<string>('')
  const [customBindings,  setCustomBindings]  = useState<Record<string, string>>(loadKeybindings)

  const resolvedTheme = useMemo(() => {
    if (liveColors) return customColorsToTheme(liveColors)
    if (appConfig.theme === 'custom' && appConfig.custom_theme && Object.keys(appConfig.custom_theme).length > 0) {
      return customColorsToTheme(appConfig.custom_theme)
    }
    return getTheme(appConfig.theme)
  }, [liveColors, appConfig.theme, appConfig.custom_theme])

  // ── Derived: focused pane ────────────────────────────────────────────────────
  const focusedPane = useMemo(() => findLeaf(activeLayout.root, activeLayout.focusedPaneId), [activeLayout])
  const activePage  = focusedPane?.activePage ?? 'terminal'

  const activeTerminalId = useMemo(() => {
    if (!focusedPane) return null
    const activeTab = tabs.find(t => t.id === focusedPane.activeTabId)
    if (activeTab?.type === 'terminal') return activeTab.id
    return focusedPane.tabIds.find(id => tabs.find(t => t.id === id)?.type === 'terminal')
      ?? focusedPane.linkedTerminalId ?? null
  }, [focusedPane, tabs])

  const activeCwd = useMemo(() => {
    return activeTerminalId ? (terminalCwds[activeTerminalId] ?? '') : ''
  }, [activeTerminalId, terminalCwds])

  // ── Derived: top-level tabs (one per workspace, shown in the global tab bar) ──
  const topLevelTabs = useMemo(() => tabs.filter(t => !t.parentId), [tabs])

  // ── Sync: remove closed tabs from layout trees; drop orphaned workspaces ─────
  useEffect(() => {
    const validIds = new Set(tabs.map(t => t.id))
    setLayouts(prev => {
      let changed = false
      const next: Record<string, Layout> = {}
      for (const [workspaceId, layout] of Object.entries(prev)) {
        if (!validIds.has(workspaceId)) { changed = true; continue }
        let root = layout.root
        for (const leaf of getAllLeaves(layout.root)) {
          for (const id of leaf.tabIds) {
            if (!validIds.has(id)) { root = removeTabFromTree(root, id); changed = true }
          }
          if (leaf.linkedTerminalId && !validIds.has(leaf.linkedTerminalId)) {
            root = clearLinkedTerminalInTree(root, leaf.linkedTerminalId); changed = true
          }
        }
        next[workspaceId] = root === layout.root ? layout : { ...layout, root }
      }
      return changed ? next : prev
    })
  }, [tabs])

  // ── Sync: assign new tabs (unassigned) to their owning workspace's focused pane ──
  useEffect(() => {
    const assignedIds = new Set(Object.values(layouts).flatMap(l => getAllLeaves(l.root).flatMap(leaf => leaf.tabIds)))
    const unassigned = tabs.filter(t => !assignedIds.has(t.id))
    if (unassigned.length === 0) return
    setLayouts(prev => {
      const next = { ...prev }
      for (const tab of unassigned) {
        const workspaceId = workspaceIdOf(tab.id, tabs)
        const layout = next[workspaceId]
        if (layout) {
          next[workspaceId] = { ...layout, root: addTabToLeaf(layout.root, layout.focusedPaneId, tab.id) }
        } else {
          const leaf = createLeaf([tab.id], tab.id)
          next[workspaceId] = { root: leaf, focusedPaneId: leaf.id }
        }
      }
      return next
    })
  }, [tabs, layouts])

  // ── Sync: keep each workspace's focusedPaneId valid ──────────────────────────
  useEffect(() => {
    setLayouts(prev => {
      let changed = false
      const next: Record<string, Layout> = {}
      for (const [workspaceId, layout] of Object.entries(prev)) {
        if (!findLeaf(layout.root, layout.focusedPaneId)) {
          next[workspaceId] = { ...layout, focusedPaneId: getFirstLeaf(layout.root).id }
          changed = true
        } else {
          next[workspaceId] = layout
        }
      }
      return changed ? next : prev
    })
  }, [layouts])

  // ── Persistence: save layouts on change ──────────────────────────────────────
  useEffect(() => {
    saveLayoutToStorage(layouts, tabs, activeWorkspaceId)
  }, [layouts, tabs, activeWorkspaceId])

  // ── Sync: keep terminal tab's activePage field current so tab-switching can restore it ──
  useEffect(() => {
    if (!activeTerminalId || !focusedPane) return
    dispatch({ type: 'set-tab-page', id: activeTerminalId, page: focusedPane.activePage })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTerminalId, focusedPane?.activePage])

  // ── Sync: path dwell for debug pages ─────────────────────────────────────────
  useEffect(() => {
    if (activePage === 'debug' || activePage === 'database' || activePage === 'editor') {
      pathDwellRef.current.forEach(entry => { entry.relatedPageVisited = true })
    }
  }, [activePage])

  // ── Config load ──────────────────────────────────────────────────────────────
  useEffect(() => {
    CheckForUpdate().then(tag => { if (tag) setUpdateTag(tag) }).catch(() => {})
  }, [])

  useEffect(() => {
    GetAppConfig().then(cfg => {
      const zoom = (cfg as unknown as AppConfig).default_zoom || defaultConfig.default_zoom
      setAppConfig(cfg as unknown as AppConfig)
      setCurrentZoom(zoom)
      localStorage.setItem('cmdide_zoom', String(zoom))
    }).catch(() => {})
  }, [])

  useEffect(() => {
    EventsOn('app:config', (cfg: AppConfig) => {
      const zoom = cfg.default_zoom || defaultConfig.default_zoom
      setAppConfig(cfg); setCurrentZoom(zoom)
      localStorage.setItem('cmdide_zoom', String(zoom))
      setLiveColors(null)
    })
    return () => EventsOff('app:config')
  }, [])

  // ── Session restore ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!appConfig.soft_close) return
    LoadSession().then(async (sessionTabs) => {
      if (!sessionTabs || sessionTabs.length === 0) return
      const restoredTabs: Tab[] = []
      for (const st of sessionTabs) {
        if (st.type === 'terminal') {
          restoredTabs.push(makeTerminalTab(undefined, st.cwd || undefined))
        } else if (st.type === 'editor' && st.file_path) {
          try {
            const content = await ReadFile(st.file_path)
            const fileName = st.file_path.replace(/\\/g, '/').split('/').pop() ?? st.file_path
            restoredTabs.push({ id: nextId(), type: 'editor', title: fileName, filePath: st.file_path, content, language: st.language || 'plaintext' })
          } catch { /* gone */ }
        }
      }
      if (restoredTabs.length > 0) {
        dispatch({ type: 'restore-session', tabs: restoredTabs })
        // Restore per-workspace pane layouts using position indices into the restored tabs array
        const saved = restoreLayoutFromStorage(restoredTabs)
        const newLayouts: Record<string, Layout> = {}
        for (const tab of restoredTabs) {
          if (tab.parentId) continue
          const layout = saved?.layouts[tab.id]
          if (layout) { newLayouts[tab.id] = layout; continue }
          const leaf = createLeaf([tab.id], tab.id)
          newLayouts[tab.id] = { root: leaf, focusedPaneId: leaf.id }
        }
        setLayouts(newLayouts)
        const restoredActiveId = saved && newLayouts[saved.activeWorkspaceId]
          ? saved.activeWorkspaceId
          : restoredTabs.find(t => !t.parentId)?.id
        if (restoredActiveId) dispatch({ type: 'select', id: restoredActiveId })
      }
    }).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appConfig.soft_close])

  // ── Theme CSS vars ───────────────────────────────────────────────────────────
  useEffect(() => {
    const root = document.documentElement
    const isCustom = appConfig.theme === 'custom' || liveColors !== null
    if (isCustom) {
      root.setAttribute('data-theme', 'custom')
      const t = resolvedTheme
      root.style.setProperty('--app-bg',               t.appBg)
      root.style.setProperty('--border-color',          t.borderColor)
      root.style.setProperty('--info-bar-bg',           t.infoBarBg)
      root.style.setProperty('--info-bar-color',        t.infoBarColor)
      root.style.setProperty('--info-bar-hover-bg',     t.infoBarHoverBg)
      root.style.setProperty('--info-bar-hover-color',  t.infoBarHoverColor)
      root.style.setProperty('--tab-color',             t.tabColor)
      root.style.setProperty('--tab-color-hover',       t.tabColorHover)
      root.style.setProperty('--tab-add-border',        t.tabAddBorder)
    } else {
      root.setAttribute('data-theme', appConfig.theme)
      for (const p of [
        '--app-bg', '--border-color', '--info-bar-bg', '--info-bar-color',
        '--info-bar-hover-bg', '--info-bar-hover-color', '--tab-color',
        '--tab-color-hover', '--tab-add-border',
      ]) root.style.removeProperty(p)
    }
  }, [resolvedTheme, appConfig.theme, liveColors])

  // ── Go events ────────────────────────────────────────────────────────────────
  useEffect(() => {
    EventsOn('app:open-file', (...args: any[]) => {
      const payload = args[0] as OpenFilePayload
      if (!payload?.path || payload.content === undefined) return
      dispatch({ type: 'open-file', payload })
    })
    return () => EventsOff('app:open-file')
  }, [])

  useEffect(() => {
    EventsOn('app:open-database', (...args: any[]) => {
      const payload = args[0] as OpenDatabasePayload
      if (!payload?.path) return
      setForcedDbPath(payload.path)
      updateLayout(activeWorkspaceId, l => ({ ...l, root: updateLeafInTree(l.root, l.focusedPaneId, leaf => ({ ...leaf, activePage: 'database' })) }))
    })
    return () => EventsOff('app:open-database')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId])

  useEffect(() => {
    EventsOn('app:open-preview', (...args: any[]) => {
      const payload = args[0] as OpenPreviewPayload
      if (!payload?.type) return
      dispatch({ type: 'open-preview', payload })
    })
    return () => EventsOff('app:open-preview')
  }, [])

  useEffect(() => {
    const handler = (e: Event) => {
      const { url, tabId } = (e as CustomEvent<{ url: string; tabId: string }>).detail
      if (!url) return
      dispatch({ type: 'open-preview', payload: { type: 'url', url, path: url, terminalId: tabId } })
    }
    window.addEventListener('ide:open-url', handler)
    return () => window.removeEventListener('ide:open-url', handler)
  }, [])

  useEffect(() => {
    EventsOn('app:open-problems', () => {
      updateLayout(activeWorkspaceId, l => ({ ...l, root: updateLeafInTree(l.root, l.focusedPaneId, leaf => ({ ...leaf, activePage: 'debug' })) }))
    })
    return () => EventsOff('app:open-problems')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId])

  useEffect(() => {
    EventsOn('app:open-config', () => {
      updateLayout(activeWorkspaceId, l => ({ ...l, root: updateLeafInTree(l.root, l.focusedPaneId, leaf => ({ ...leaf, activePage: 'settings' })) }))
    })
    return () => EventsOff('app:open-config')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId])

  useEffect(() => {
    EventsOn('app:open-tab', (...args: any[]) => {
      const p = args[0] as { type: string; title: string; terminalId?: string; cwd?: string }
      if (!p?.type) return
      if (p.type === 'plugins') {
        if (!__PLUGINS__) return
        updateLayout(activeWorkspaceId, l => ({ ...l, root: updateLeafInTree(l.root, l.focusedPaneId, leaf => ({ ...leaf, activePage: 'plugins' })) }))
        return
      }
      if (p.type === 'fullscreen') {
        updateLayout(activeWorkspaceId, l => ({ ...l, root: updateLeafInTree(l.root, l.focusedPaneId, leaf => ({ ...leaf, activePage: 'editor' })) }))
        return
      }
      dispatch({ type: 'open-tab', tabType: p.type, title: p.title, terminalId: p.terminalId, cwd: p.cwd })
    })
    return () => EventsOff('app:open-tab')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId])

  useEffect(() => {
    const handler = (e: Event) => {
      if (!__PLUGINS__) return
      type Detail = { type: string; title: string; terminalId?: string; cwd?: string }
      const detail = (e as CustomEvent<Detail>).detail
      if (!detail?.type) return
      dispatch({ type: 'open-tab', tabType: detail.type, title: detail.title, terminalId: detail.terminalId, cwd: detail.cwd })
    }
    window.addEventListener('terminal:open-plugin-tab', handler)
    return () => window.removeEventListener('terminal:open-plugin-tab', handler)
  }, [])

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────
  const shortcutHandlers: ShortcutHandlers = {
    'next-tab': () => {
      const idx  = topLevelTabs.findIndex(t => t.id === activeWorkspaceId)
      const next = topLevelTabs[(idx + 1) % topLevelTabs.length]
      if (next) dispatch({ type: 'select', id: next.id })
    },
    'prev-tab': () => {
      const n    = topLevelTabs.length
      const idx  = topLevelTabs.findIndex(t => t.id === activeWorkspaceId)
      const prev = topLevelTabs[(idx - 1 + n) % n]
      if (prev) dispatch({ type: 'select', id: prev.id })
    },
    'close-tab':     () => handleCloseTab(activeWorkspaceId),
    'new-terminal':  () => handleNewWorkspaceTab(),
    'open-search':   () => setSearchOpen(v => !v),
    'go-terminal':   () => handleSidebarNavigate('terminal'),
    'go-editor':     () => handleSidebarNavigate('editor'),
    'open-settings': () => handleSidebarNavigate('settings'),
    ...Object.fromEntries(
      [1,2,3,4,5,6,7,8,9].map(n => [`tab-${n}`, () => {
        const tab = topLevelTabs[n - 1]
        if (tab) dispatch({ type: 'select', id: tab.id })
      }]),
    ),
  }
  useShortcuts(shortcutHandlers, customBindings)

  // ── Quit ─────────────────────────────────────────────────────────────────────
  const handleQuit = useCallback(async () => {
    try {
      if (appConfig.soft_close) {
        const sessionTabs = await Promise.all(tabs.map(async t => {
          if (t.type === 'terminal') {
            const cwd = await GetTerminalCwd(t.id).catch(() => '')
            return { type: t.type, file_path: '', language: '', cwd }
          }
          return { type: t.type, file_path: t.filePath ?? '', language: t.language ?? '', cwd: '' }
        }))
        await Promise.race([
          SaveSession(sessionTabs).catch(() => {}),
          new Promise<void>(resolve => setTimeout(resolve, 1500)),
        ])
      }
    } catch { /* ignore */ }
    Quit()
  }, [appConfig.soft_close, tabs])

  // ── Pane operations ───────────────────────────────────────────────────────────

  const handleFocusPane = useCallback((paneId: string) => {
    updateLayout(activeWorkspaceId, l => ({ ...l, focusedPaneId: paneId }))
  }, [activeWorkspaceId, updateLayout])

  const handleClosePane = useCallback((paneId: string) => {
    updateLayout(activeWorkspaceId, l => {
      const result = closePaneInTree(l.root, paneId)
      if (result === null) return l
      const focusedPaneId = l.focusedPaneId === paneId ? getFirstLeaf(result).id : l.focusedPaneId
      return { root: result, focusedPaneId }
    })
  }, [activeWorkspaceId, updateLayout])

  const handleRatioChange = useCallback((splitId: string, ratio: number) => {
    updateLayout(activeWorkspaceId, l => ({ ...l, root: updateRatioInTree(l.root, splitId, ratio) }))
  }, [activeWorkspaceId, updateLayout])

  const handleSelectTab = useCallback((paneId: string, tabId: string, workspaceId: string = activeWorkspaceId) => {
    const tab = tabs.find(t => t.id === tabId)
    // Restore the terminal's last known page; non-terminal tabs always show 'terminal' activePage
    const newActivePage: PageId = tab?.type === 'terminal' ? (tab.activePage ?? 'terminal') : 'terminal'
    updateLayout(workspaceId, l => ({
      root: updateLeafInTree(l.root, paneId, leaf => ({ ...leaf, activeTabId: tabId, activePage: newActivePage })),
      focusedPaneId: paneId,
    }))
  }, [tabs, activeWorkspaceId, updateLayout])

  const handleCloseTab = useCallback((tabId: string) => {
    dispatch({ type: 'close', id: tabId })
  }, [])

  const handleNewWorkspaceTab = useCallback(() => {
    const newId = nextId()
    dispatch({ type: 'add-terminal', id: newId })
    const leaf = createLeaf([newId], newId)
    setLayouts(prev => ({ ...prev, [newId]: { root: leaf, focusedPaneId: leaf.id } }))
  }, [])

  const handleNewTerminal = useCallback((paneId: string) => {
    const newId = nextId()
    dispatch({ type: 'add-terminal', id: newId, parentId: activeWorkspaceId, keepActive: true })
    updateLayout(activeWorkspaceId, l => ({
      root: updateLeafInTree(addTabToLeaf(l.root, paneId, newId), paneId, leaf => ({ ...leaf, activePage: 'terminal' })),
      focusedPaneId: paneId,
    }))
  }, [activeWorkspaceId, updateLayout])

  const handleDuplicateTab = useCallback(async (tabId: string) => {
    const tab = tabs.find(t => t.id === tabId)
    if (!tab || tab.type !== 'terminal') return
    const cwd = await GetTerminalCwd(tabId).catch(() => '')
    const newId = nextId()
    const workspaceId = workspaceIdOf(tabId, tabs)
    const layout = layouts[workspaceId]
    const pane = layout ? findLeaf(layout.root, layout.focusedPaneId) : null
    dispatch({ type: 'add-terminal', id: newId, parentId: tabId, initialCwd: cwd || undefined, keepActive: true })
    if (pane) {
      updateLayout(workspaceId, l => ({ ...l, root: addTabToLeaf(l.root, pane.id, newId) }))
    }
  }, [tabs, layouts, updateLayout])

  // ── Sidebar navigation ────────────────────────────────────────────────────────

  const handleSidebarNavigate = useCallback((page: PageId) => {
    updateLayout(activeWorkspaceId, l => ({ ...l, root: updateLeafInTree(l.root, l.focusedPaneId, leaf => ({ ...leaf, activePage: page })) }))
  }, [activeWorkspaceId, updateLayout])

  const handleSelectRecentPath = useCallback((path: string) => {
    if (!activeTerminalId) return
    window.dispatchEvent(new CustomEvent('terminal:cd-to', { detail: { terminalId: activeTerminalId, path } }))
  }, [activeTerminalId])

  const handlePanelMove = useCallback((page: PageId, dir: 'left' | 'right' | 'up' | 'down') => {
    const direction = (dir === 'left' || dir === 'right') ? 'h' : 'v'
    const newLeafFirst = dir === 'left' || dir === 'up'
    const sourcePane = findLeaf(activeLayout.root, activeLayout.focusedPaneId)
    const linkedTerminalId = sourcePane
      ? (sourcePane.tabIds.map(id => tabs.find(t => t.id === id)).find(t => t?.type === 'terminal')?.id
          ?? sourcePane.linkedTerminalId)
      : undefined
    const newLeaf = createLeaf([], '', page, linkedTerminalId)
    updateLayout(activeWorkspaceId, l => ({
      root: splitPaneInTree(l.root, l.focusedPaneId, direction, newLeaf, newLeafFirst),
      focusedPaneId: newLeaf.id,
    }))
  }, [activeLayout, activeWorkspaceId, tabs, updateLayout])

  const handleStartPageDrag = useCallback((page: PageId, startX: number, startY: number) => {
    // Dragging the page that's already open in the focused pane to split is disabled — it broke the UI.
    if (page === activePage) return

    const state = { dragging: false, edge: null as 'up' | 'down' | 'left' | 'right' | null }

    const onMove = (e: MouseEvent) => {
      if (!state.dragging) {
        const dx = e.clientX - startX
        const dy = e.clientY - startY
        if (Math.hypot(dx, dy) < 6) return
        state.dragging = true
        document.body.style.cursor = 'grabbing'
        setPageDrag({ page })
      }

      const el = contentAreaRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top

      let edge: typeof state.edge = null
      if (x >= 0 && y >= 0 && x <= rect.width && y <= rect.height) {
        const ndx = x / rect.width - 0.5
        const ndy = y / rect.height - 0.5
        edge = Math.abs(ndx) > Math.abs(ndy) ? (ndx < 0 ? 'left' : 'right') : (ndy < 0 ? 'up' : 'down')
      }

      if (edge !== state.edge) {
        state.edge = edge
        setDropEdge(edge)
      }
    }

    const onUp = () => {
      if (state.dragging && state.edge) handlePanelMove(page, state.edge)
      setPageDrag(null)
      setDropEdge(null)
      document.body.style.cursor = ''
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [handlePanelMove, activePage])

  // ── Theme helpers ─────────────────────────────────────────────────────────────
  const handleApplyColors  = useCallback((colors: Record<string, string>) => setLiveColors(colors), [])
  const handleSaveTheme    = useCallback(async (colors: Record<string, string>) => SaveCustomTheme(colors), [])
  const handleSaveSettings = useCallback(async (cfg: AppConfig) => {
    await SaveAppConfig(cfg as unknown as Parameters<typeof SaveAppConfig>[0])
    setAppConfig(cfg)
  }, [])

  const handleSaveKeybindings = useCallback((bindings: Record<string, string>) => {
    saveKeybindings(bindings)
    setCustomBindings(bindings)
  }, [])

  // ── Problems helpers ──────────────────────────────────────────────────────────
  const [probSources,  setProbSources]  = useState<string[]>([])
  const [probItems,    setProbItems]    = useState<ProbItem[]>([])
  const [probScanning, setProbScanning] = useState(false)
  const [cweItems,     setCweItems]     = useState<CweItem[]>([])
  const [cweScanning,  setCweScanning]  = useState(false)

  useEffect(() => {
    if (activePage !== 'debug' || !activeCwd) return
    setProbScanning(true)
    ScanProblems(activeCwd)
      .then(result => {
        const r = result as { sources?: string[]; items?: ProbItem[] }
        setProbSources(r.sources ?? []); setProbItems(r.items ?? [])
      })
      .catch(() => {})
      .finally(() => setProbScanning(false))
  }, [activePage, activeCwd])

  useEffect(() => { setProbItems([]); setProbSources([]) }, [activeCwd])
  useEffect(() => { setCweItems([]) }, [activeCwd])

  const handleCweScan = useCallback(async (scanCwd: string) => {
    setCweScanning(true)
    try { setCweItems(Array.isArray(await ScanCWE(scanCwd)) ? await ScanCWE(scanCwd) as CweItem[] : []) }
    catch { /* ignore */ }
    setCweScanning(false)
  }, [])

  const handleRescanProblems = useCallback(async (tabId: string, cwd: string) => {
    const result = await ScanProblems(cwd).catch(() => null)
    if (!result) return
    const r = result as { sources?: string[]; items?: ProbItem[] }
    dispatch({ type: 'update-problems', id: tabId, sources: r.sources ?? [], items: r.items ?? [] })
  }, [])

  const handleOpenFileAtLine = useCallback(async (path: string, line: number, _col: number) => {
    try {
      const content = await ReadFile(path)
      const lang    = await GetFileLanguage(path)
      dispatch({ type: 'open-file', payload: { path, content, language: lang, gotoLine: line } })
    } catch { /* gone */ }
  }, [])

  useEffect(() => {
    const handler = (e: Event) => {
      const { path } = (e as CustomEvent<{ path: string }>).detail
      if (path) void handleOpenFileAtLine(path, 0, 0)
    }
    window.addEventListener('ide:ctrl-click-file', handler)
    return () => window.removeEventListener('ide:ctrl-click-file', handler)
  }, [handleOpenFileAtLine])

  // ── Ctrl+C copy (handled before xterm) ────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'c') {
        const sel = window.getSelection()?.toString()
        if (sel) { e.preventDefault(); void navigator.clipboard.writeText(sel) }
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [])

  // ── Terminal cwd change (used by overlay terminals) ───────────────────────────
  const handleTerminalCwdChange = useCallback((tabId: string, cwd: string) => {
    setTerminalCwds(prev => ({ ...prev, [tabId]: cwd }))
    const prev = pathDwellRef.current.get(tabId)
    if (prev && prev.path !== cwd) {
      const dwell = Date.now() - prev.enteredAt
      if (dwell >= 60000 || prev.relatedPageVisited) setRecentPaths(saveRecentPath(prev.path))
    }
    pathDwellRef.current.set(tabId, { path: cwd, enteredAt: Date.now(), relatedPageVisited: false })
  }, [])

  // ── Render: pane sidebar page ─────────────────────────────────────────────────
  function renderSidebarPage(pane: LeafPane, paneTerminalId: string | null, paneCwd: string): React.ReactNode {
    return (
      <div className="absolute inset-0 bg-[var(--app-bg)] flex flex-col overflow-hidden">
        {/* 'editor' page is rendered by the always-mounted FullscreenIDE overlay below SplitPaneView,
            so its state (open files, explorer, cursor position) survives switching pages/tabs. */}
        {pane.activePage === 'database' && (
          <DatabasePage key={paneTerminalId ?? 'no-terminal'} terminalId={paneTerminalId} cwd={paneCwd}
            initialDbPath={forcedDbPath} privacyMode={appConfig.database_privacy} />
        )}
        {pane.activePage === 'debug' && (
          <Problems
            tabId={(paneTerminalId ?? 'prb') + '-' + pane.id}
            cwd={paneCwd} sources={probSources} items={probItems}
            scanning={probScanning} cweItems={cweItems} cweScanning={cweScanning}
            onRescan={async (_, scanCwd) => {
              setProbScanning(true)
              try {
                const r = await ScanProblems(scanCwd) as { sources?: string[]; items?: ProbItem[] }
                setProbSources(r.sources ?? []); setProbItems(r.items ?? [])
              } catch { /* ignore */ }
              setProbScanning(false)
            }}
            onOpenFile={(path, line, col) => {
              void handleOpenFileAtLine(path, line, col)
              updateLayout(activeWorkspaceId, l => ({ ...l, root: updateLeafInTree(l.root, pane.id, lf => ({ ...lf, activePage: 'terminal' })) }))
            }}
            onCweScan={cwd => { void handleCweScan(cwd) }}
          />
        )}
        {pane.activePage === 'settings' && (
          <ConfigEditor appConfig={appConfig} onSaveSettings={handleSaveSettings}
            onApply={handleApplyColors} onSaveTheme={handleSaveTheme}
            keybindings={customBindings} onSaveKeybindings={handleSaveKeybindings} />
        )}
        {pane.activePage === 'plugins' && __PLUGINS__ && (
          <PluginStore onPluginChange={reloadPlugins} />
        )}
        {pane.activePage === 'ports' && (
          <PortsTab tabId={(paneTerminalId ?? 'ports') + '-' + pane.id} active={true} />
        )}
        {pane.activePage === 'versioncontrol' && (
          <VersionControlPanel cwd={paneCwd} active={true} />
        )}
        {pane.activePage === 'workflows' && (
          <WorkflowsPanel cwd={paneCwd} active={true}
            monacoTheme={resolvedTheme.monacoThemeId} monacoThemeDef={resolvedTheme.monacoThemeDef} />
        )}
        {pane.activePage === 'notepad' && (
          <NotepadPage cwd={paneCwd} />
        )}
      </div>
    )
  }

  // ── Render: non-terminal tab content ─────────────────────────────────────────
  function renderNonTerminalContent(tab: Tab): React.ReactNode {
    if (tab.type === 'editor') {
      return (
        <Editor tabId={tab.id} filePath={tab.filePath!} content={tab.content ?? ''}
          language={tab.language ?? 'plaintext'} active={true}
          indentGuides={appConfig.indent_guides} monacoTheme={resolvedTheme.monacoThemeId}
          monacoThemeDef={resolvedTheme.monacoThemeDef} minimap={appConfig.minimap}
          defaultZoom={currentZoom} gotoLine={tab.gotoLine} />
      )
    }
    if (tab.type === 'database') return <Database dbPath={tab.dbPath!} privacyMode={appConfig.database_privacy} />
    if (tab.type === 'debug') {
      return (
        <Problems tabId={tab.id} cwd={tab.problemsCwd!} sources={tab.problemsSources ?? []}
          items={tab.problemsItems ?? []} scanning={false}
          onRescan={(id, cwd) => { void handleRescanProblems(id, cwd) }}
          onOpenFile={(path, line, col) => { void handleOpenFileAtLine(path, line, col) }} />
      )
    }
    if (tab.type === 'preview') return <Preview previewType={tab.previewType!} src={tab.previewSrc!} path={tab.previewPath!} />
    if (tab.type === 'ports') return <PortsTab tabId={tab.id} active={true} />
    if (tab.type === 'perf')  return <PerfTab  tabId={tab.id} active={true} />
    if (tab.type === 'plugins' && __PLUGINS__) return <PluginStore onPluginChange={reloadPlugins} />
    if (!__PLUGINS__) return null
    const plugin = plugins[tab.type]
    if (plugin?.TabComponent) {
      const context: PluginContext = {
        terminalId: tab.parentId, cwd: tab.meta?.cwd,
        executeCommand: tab.parentId
          ? (cmd: string) => window.dispatchEvent(new CustomEvent('plugin:execute', { detail: { terminalId: tab.parentId, cmd } }))
          : undefined,
        openFile: (path: string) => handleOpenFileAtLine(path, 0, 0),
      }
      return (
        <PluginErrorBoundary pluginName={plugin.name}>
          <plugin.TabComponent tabId={tab.id} active={true} context={context} />
        </PluginErrorBoundary>
      )
    }
    return null
  }

  // ── Render: leaf pane content callback ───────────────────────────────────────
  // Terminals are NOT rendered here — they live in the overlay layer below SplitPaneView
  // so they are never unmounted when the pane tree restructures during splits.
  const renderContent = useCallback((pane: LeafPane): React.ReactNode => {
    const paneTabs = pane.tabIds.map(id => tabs.find(t => t.id === id)).filter((t): t is Tab => t !== undefined)
    const activeTab = paneTabs.find(t => t.id === pane.activeTabId)

    const paneTerminalId = getPaneTerminalId(pane, tabs)
    const paneCwd = paneTerminalId ? (terminalCwds[paneTerminalId] ?? '') : ''

    // Non-terminal sidebar pages
    if (pane.activePage !== 'terminal') {
      return renderSidebarPage(pane, paneTerminalId, paneCwd)
    }

    // Terminal page with no tabs
    if (paneTabs.length === 0) {
      // Page-only pane linked to another pane's terminal — rendered in overlay layer below
      if (pane.linkedTerminalId) return null
      return (
        <div className="absolute inset-0 flex items-center justify-center">
          <button
            className="px-3 py-1.5 text-[12px] text-[var(--tab-color)] bg-surface-raised rounded-md border border-[var(--border-color)] hover:text-[var(--tab-color-hover)] cursor-pointer transition-colors"
            onClick={() => handleNewTerminal(pane.id)}
          >
            New Terminal
          </button>
        </div>
      )
    }

    // Terminal page with non-terminal active tab
    if (activeTab && activeTab.type !== 'terminal') {
      return (
        <div className="absolute inset-0">
          {renderNonTerminalContent(activeTab)}
        </div>
      )
    }

    // Terminal page with terminal active — rendered in overlay layer, nothing here
    return null
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, terminalCwds, appConfig, currentZoom, resolvedTheme, pluginCommands, plugins,
      forcedDbPath, probSources, probItems, probScanning, cweItems, cweScanning, handleNewTerminal])

  // ── Determine if tree has only one pane ───────────────────────────────────────
  const isOnlyPane = useMemo(() => getAllLeaves(activeLayout.root).length <= 1, [activeLayout])

  // ── Render ────────────────────────────────────────────────────────────────────
  const wcBtnBase = "flex items-center justify-center w-9 h-[30px] rounded-sm bg-transparent border-0 outline-none cursor-pointer text-[var(--tab-color)] transition-[background,color] duration-[100ms] p-0"

  const windowControls = useMemo(() => (
    <div className="flex items-center gap-0.5 px-1.5">
      {updateTag && (
        <>
          <button
            className="flex items-center justify-center w-[28px] h-[28px] border-0 outline-none rounded p-0 bg-transparent text-[#3fb950] cursor-pointer shrink-0 transition-[background,color] duration-[120ms] hover:bg-[rgba(63,185,80,0.15)] hover:text-[#56d364]"
            title={`Update available: ${updateTag} — click to install`}
            onClick={() => PerformUpdate(updateTag).catch(() => {})}
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <path d="M8 2v9M5 8l3 3 3-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M3 13h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
          </button>
          <div className="w-px h-4 bg-sep shrink-0 mx-0.5" />
        </>
      )}
      <button className={wcBtnBase + " hover:text-[var(--tab-color-hover)] hover:bg-surface-raised"} onClick={WindowMinimise} aria-label="Minimise">
        <svg width="12" height="2" viewBox="0 0 12 2"><path d="M0 1h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
      </button>
      <button className={wcBtnBase + " hover:text-[var(--tab-color-hover)] hover:bg-surface-raised"} onClick={WindowToggleMaximise} aria-label="Maximise" onDoubleClick={WindowToggleMaximise}>
        <svg width="12" height="12" viewBox="0 0 12 12"><rect x="0.75" y="0.75" width="10.5" height="10.5" rx="1.5" stroke="currentColor" strokeWidth="1.5" fill="none"/></svg>
      </button>
      <button className={wcBtnBase + " hover:bg-error hover:text-white"} onClick={handleQuit} aria-label="Close">
        <svg width="12" height="12" viewBox="0 0 12 12"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
      </button>
    </div>
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [updateTag, handleQuit])

  return (
    <div className="flex flex-col w-screen h-screen overflow-hidden bg-[var(--app-bg)] font-ui" onContextMenu={e => e.preventDefault()}>

      {/* ── Overlays ─────────────────────────────────────────────────────────────── */}
      {searchOpen && (
        <SearchPalette
          tabs={tabs}
          activeTerminalId={activeTerminalId}
          onSelectTab={id => {
            const found = Object.entries(layouts)
              .flatMap(([wsId, l]) => getAllLeaves(l.root).map(leaf => ({ wsId, leaf })))
              .find(({ leaf }) => leaf.tabIds.includes(id))
            if (found) {
              if (found.wsId !== activeWorkspaceId) dispatch({ type: 'select', id: found.wsId })
              handleSelectTab(found.leaf.id, id, found.wsId)
            }
            setSearchOpen(false)
          }}
          onOpenFile={(path, line) => { void handleOpenFileAtLine(path, line ?? 0, 0); setSearchOpen(false) }}
          onClose={() => setSearchOpen(false)}
        />
      )}

      <ZoomIndicator enabled={appConfig.zoom_insights} defaultZoom={appConfig.default_zoom} onZoomChange={setCurrentZoom} />
      <WorkflowRunToasts />

      {/* ── Body: sidebar + pane tree ─────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden flex">

        {pageDrag && <style>{`* { cursor: grabbing !important; }`}</style>}

        <Sidebar
          activePage={activePage}
          onNavigate={handleSidebarNavigate}
          onSearch={() => setSearchOpen(true)}
          onStartPageDrag={handleStartPageDrag}
          showPlugins={__PLUGINS__}
          recentPaths={recentPaths}
          onSelectRecentPath={handleSelectRecentPath}
        />

        {/* Pane column: global tab bar on top, split area below */}
        <div className="flex-1 overflow-hidden flex flex-col">

          {/* Single global tab bar — one entry per top-level tab (workspace) */}
          <PaneTabBar
            paneId={activeWorkspaceId}
            tabs={topLevelTabs}
            activeId={activeWorkspaceId}
            canClosePane={false}
            windowControls={windowControls}
            onSelect={tabId => dispatch({ type: 'select', id: tabId })}
            onClose={handleCloseTab}
            onNewTerminal={handleNewWorkspaceTab}
            onClosePane={() => {}}
            onRename={(id, title) => dispatch({ type: 'rename-tab', id, title })}
            onSetColor={(id, color) => dispatch({ type: 'set-tab-color', id, color })}
            onDuplicate={id => { void handleDuplicateTab(id) }}
            onDrop={() => {}}
          />

          {/* Split area — ref tracks size for terminal overlay positioning */}
          <div ref={contentAreaRef} className="flex-1 overflow-hidden relative">

            {/* Drag-to-split drop zone overlay */}
            {pageDrag && (
              <div
                className="absolute inset-0 z-[100] pointer-events-none"
                style={{
                  borderTop:    dropEdge === 'up'    ? '2px solid rgba(10,132,255,0.85)' : '2px solid transparent',
                  borderBottom: dropEdge === 'down'  ? '2px solid rgba(10,132,255,0.85)' : '2px solid transparent',
                  borderLeft:   dropEdge === 'left'  ? '2px solid rgba(10,132,255,0.85)' : '2px solid transparent',
                  borderRight:  dropEdge === 'right' ? '2px solid rgba(10,132,255,0.85)' : '2px solid transparent',
                }}
              >
                {dropEdge && (
                  <div
                    className="absolute bg-[rgba(10,132,255,0.06)]"
                    style={
                      dropEdge === 'up'    ? { top: 0, left: 0, right: 0, bottom: '67%' } :
                      dropEdge === 'down'  ? { top: '67%', left: 0, right: 0, bottom: 0 } :
                      dropEdge === 'left'  ? { top: 0, left: 0, right: '67%', bottom: 0 } :
                                            { top: 0, left: '67%', right: 0, bottom: 0 }
                    }
                  />
                )}
              </div>
            )}

            <SplitPaneView
              node={activeLayout.root}
              focusedPaneId={activeLayout.focusedPaneId}
              isOnlyPane={isOnlyPane}
              onFocus={handleFocusPane}
              onClosePane={handleClosePane}
              onRatioChange={handleRatioChange}
              renderContent={renderContent}
            />

          {/* Terminal overlay — keyed by tab ID, never unmounts on split/close */}
          {contentAreaSize.w > 0 && tabs.filter(t => t.type === 'terminal').map(tab => {
            const allLeaves = Object.values(layouts).flatMap(l => getAllLeaves(l.root))
            const owningLeaf = allLeaves.find(l => l.tabIds.includes(tab.id))
            let leaf: LeafPane | undefined
            let visible = false
            if (owningLeaf && owningLeaf.activePage === 'terminal') {
              const leafTabs = owningLeaf.tabIds.map(id => tabs.find(t => t.id === id)).filter((t): t is Tab => t !== undefined)
              const activeTab = leafTabs.find(t => t.id === owningLeaf.activeTabId)
              const showTerminalPage = !activeTab || activeTab.type === 'terminal'
              if (showTerminalPage && tab.id === owningLeaf.activeTabId) { leaf = owningLeaf; visible = true }
            }
            if (!visible) {
              // Page-only pane (created by dragging the "terminal" page to split)
              // shows the linked tab's terminal even though it doesn't own the tab
              const linkedLeaf = allLeaves.find(l =>
                l.tabIds.length === 0 && l.linkedTerminalId === tab.id && l.activePage === 'terminal')
              if (linkedLeaf) { leaf = linkedLeaf; visible = true }
            }
            // Only show in the overlay if the owning leaf belongs to the active workspace's layout
            if (visible && leaf && !findLeaf(activeLayout.root, leaf.id)) visible = false
            const rect = (visible && leaf) ? getPaneContentRect(activeLayout.root, leaf.id, 0, 0, contentAreaSize.w, contentAreaSize.h) : null
            return (
              <div
                key={tab.id}
                style={{
                  position: 'absolute',
                  left: rect?.x ?? 0, top: rect?.y ?? 0,
                  width: rect?.w ?? 0, height: rect?.h ?? 0,
                  display: visible ? 'flex' : 'none',
                  flexDirection: 'column',
                  pointerEvents: visible ? 'auto' : 'none',
                }}
              >
                <Terminal
                  tabId={tab.id}
                  active={visible && !!leaf && leaf.id === activeLayout.focusedPaneId}
                  xtermTheme={resolvedTheme.xtermTheme}
                  initialCwd={tab.initialCwd}
                  defaultZoom={currentZoom}
                  commandAlignment={(appConfig.command_alignment as 'default' | 'top' | 'bottom') ?? 'default'}
                  pluginCommands={pluginCommands}
                  onCwdChange={cwd => handleTerminalCwdChange(tab.id, cwd)}
                />
              </div>
            )
          })}

          {/* Code Editor overlay — one FullscreenIDE per pane that has shown the
              editor page, kept mounted (like terminals) so explorer state, open
              files, and cursor/scroll positions survive switching pages/tabs */}
          {contentAreaSize.w > 0 && editorLeafIds.map(leafId => {
            const found = allLeavesWithWs.find(({ leaf }) => leaf.id === leafId)
            if (!found) return null
            const { wsId, leaf } = found
            const paneTerminalId = getPaneTerminalId(leaf, tabs)
            const paneCwd = paneTerminalId ? (terminalCwds[paneTerminalId] ?? '') : ''
            const visible = wsId === activeWorkspaceId && leaf.activePage === 'editor' && !!findLeaf(activeLayout.root, leafId)
            const rect = visible ? getPaneContentRect(activeLayout.root, leafId, 0, 0, contentAreaSize.w, contentAreaSize.h) : null
            return (
              <div
                key={leafId}
                style={{
                  position: 'absolute',
                  left: rect?.x ?? 0, top: rect?.y ?? 0,
                  width: rect?.w ?? 0, height: rect?.h ?? 0,
                  display: visible && rect ? 'block' : 'none',
                }}
              >
                <FullscreenIDE cwd={paneCwd} theme={resolvedTheme} indentGuides={appConfig.indent_guides}
                  minimap={appConfig.minimap} wordWrap={appConfig.file_word_wrap} defaultZoom={currentZoom} />
              </div>
            )
          })}
          </div>{/* end split area */}
        </div>{/* end pane column */}
      </div>

      {/* ── Status bar ────────────────────────────────────────────────────────── */}
      <div className="flex items-center h-[22px] shrink-0 bg-[var(--info-bar-bg)] border-t border-[var(--border-color)] font-ui text-[11px] text-[var(--info-bar-color)] select-none overflow-hidden px-1.5 gap-1">
        {activeTerminalId && terminalCwds[activeTerminalId] && (
          <>
            <button
              className="flex items-center gap-[5px] py-px px-[7px] rounded-xs bg-transparent border-0 cursor-pointer text-[var(--info-bar-color)] font-ui text-[11px] whitespace-nowrap overflow-hidden text-ellipsis max-w-[400px] transition-[background,color] duration-[100ms] hover:bg-surface-raised hover:text-[var(--info-bar-hover-color)]"
              onClick={() => window.dispatchEvent(new CustomEvent('terminal:select-dir', { detail: { terminalId: activeTerminalId } }))}
              title="Click to change directory"
            >
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, opacity: 0.6 }}>
                <path d="M1 4.5A1.5 1.5 0 012.5 3h3.086a1.5 1.5 0 011.06.44l.915.914A1.5 1.5 0 008.62 4.5H13.5A1.5 1.5 0 0115 6v6a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 011 12V4.5z"
                  stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
              </svg>
              <span className="overflow-hidden text-ellipsis font-mono">{terminalCwds[activeTerminalId].replace(/\\/g, '/')}</span>
            </button>
            <div className="w-px h-3 bg-sep shrink-0" />
          </>
        )}
        <div className="ml-auto flex items-center gap-2 opacity-40 text-[10.5px]">
          <span>cmdIDE</span>
        </div>
      </div>
    </div>
  )
}
