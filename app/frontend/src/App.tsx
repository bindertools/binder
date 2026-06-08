import React, { useReducer, useEffect, useRef, useState, useCallback, useMemo } from 'react'
import SplitModal from './components/SplitModal'
import Terminal from './components/Terminal'
import Editor from './components/Editor'
import Database from './components/Database'
import Preview from './components/Preview'
import Problems, { type CweItem } from './components/Problems'
import ConfigEditor from './components/ConfigEditor'
import ZoomIndicator from './components/ZoomIndicator'
import SearchPalette from './components/SearchPalette'
import TabBar from './components/TabBar'
import Sidebar, { PageId } from './components/Sidebar'
import DatabasePage from './components/DatabasePage'
import PortsTab from './components/PortsTab'
import PerfTab from './components/PerfTab'
import PluginStore from './plugins/PluginStore'
import FullscreenIDE from './fullscreen/FullscreenIDE'
import { buildInstalledPluginCommandMap, loadInstalledPlugins, bootstrapBuiltins, type InstalledPluginCommand, type Plugin, type PluginContext } from './plugins'
import { Tab, ProbItem, OpenFilePayload, OpenDatabasePayload, OpenPreviewPayload, OpenProblemsPayload, AppConfig } from './types'
import { EventsOn, EventsOff, Quit, WindowMinimise, WindowToggleMaximise } from '../wailsjs/runtime/runtime'
import { GetAppConfig, SaveSession, LoadSession, ReadFile, GetFileLanguage, GetTerminalCwd, ScanProblems, ScanCWE, SaveCustomTheme, SaveAppConfig, CheckForUpdate, PerformUpdate } from '../wailsjs/go/main/App'
import { useDragRegions } from './lib/useDragRegions'
import { getTheme, customColorsToTheme } from './themes'
import './App.css'

let tabCounter = 0
// Include a per-session timestamp so IDs never collide with a zombie PTY left
// by a previous crash (backend reuses the same ID if the process didn't restart).
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

function saveRecentPath(newPath: string): void {
  try {
    const current = loadRecentPaths().filter(p => p !== newPath)
    const updated = [newPath, ...current].slice(0, 7)
    localStorage.setItem(RECENT_PATHS_KEY, JSON.stringify(updated))
  } catch { /* ignore */ }
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

function tabReducer(state: TabState, action: TabAction): TabState {
  switch (action.type) {

    case 'add-terminal': {
      const tab = makeTerminalTab(action.id, action.initialCwd, action.parentId)
      const newTabs = [...state.tabs]
      if (action.parentId) {
        let insertIdx = newTabs.length
        for (let i = newTabs.length - 1; i >= 0; i--) {
          if (newTabs[i].id === action.parentId || newTabs[i].parentId === action.parentId) {
            insertIdx = i + 1
            break
          }
        }
        newTabs.splice(insertIdx, 0, tab)
      } else {
        newTabs.push(tab)
      }
      return {
        tabs: newTabs,
        activeId: action.keepActive ? state.activeId : tab.id,
      }
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
      const tab: Tab = {
        id: nextId(), type: 'database', title: fileName,
        dbPath: payload.path, parentId: payload.terminalId,
      }
      return insertNearParent(state, tab, payload.terminalId)
    }

    case 'open-preview': {
      const { payload } = action
      const previewKey = payload.type === 'url' ? payload.url! : payload.path!
      const existing = state.tabs.find(t => t.type === 'preview' && t.previewPath === previewKey)
      if (existing) return { ...state, activeId: existing.id }
      const title = previewKey.replace(/\\/g, '/').split('/').pop() ?? previewKey
      const previewSrc = payload.type === 'url'
        ? payload.url!
        : (payload.url ?? payload.content ?? '')
      const tab: Tab = {
        id: nextId(), type: 'preview', title,
        previewType: payload.type,
        previewSrc,
        previewPath: previewKey,
        parentId: payload.terminalId,
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
            ? { ...t, problemsSources: payload.sources, problemsItems: payload.items }
            : t),
        }
      }
      const tab: Tab = {
        id: nextId(), type: 'debug', title: 'Debug',
        parentId: payload.terminalId,
        problemsCwd: payload.cwd,
        problemsSources: payload.sources,
        problemsItems: payload.items,
      }
      return insertNearParent(state, tab, payload.terminalId)
    }

    case 'open-config': {
      const existing = state.tabs.find(t => t.type === 'config')
      if (existing) return { ...state, activeId: existing.id }
      const tab: Tab = {
        id: nextId(), type: 'config', title: 'Settings',
        parentId: action.terminalId,
      }
      return insertNearParent(state, tab, action.terminalId)
    }

    case 'open-tab': {
      if (action.tabType !== 'fullscreen') {
        const existing = state.tabs.find(t => t.type === action.tabType)
        if (existing) return { ...state, activeId: existing.id }
      }
      const tab: Tab = {
        id: nextId(),
        type: action.tabType as Tab['type'],
        title: action.title,
        parentId: action.terminalId,
        ...(action.cwd ? { meta: { cwd: action.cwd } } : {}),
      }
      return insertNearParent(state, tab, action.terminalId)
    }

    case 'update-problems': {
      return {
        ...state,
        tabs: state.tabs.map(t => t.id === action.id
          ? { ...t, problemsSources: action.sources, problemsItems: action.items }
          : t),
      }
    }

    case 'rename-tab': {
      const title = action.title.trim()
      if (!title) return state
      return { ...state, tabs: state.tabs.map(t => t.id === action.id ? { ...t, title } : t) }
    }

    case 'set-tab-color': {
      return {
        ...state,
        tabs: state.tabs.map(t => t.id === action.id ? { ...t, color: action.color ?? undefined } : t),
      }
    }

    case 'close': {
      if (state.tabs.length <= 1) return state
      const idx = state.tabs.findIndex(t => t.id === action.id)
      const newTabs = state.tabs.filter(t => t.id !== action.id)
      const newActiveId = state.activeId === action.id
        ? newTabs[Math.min(idx, newTabs.length - 1)].id
        : state.activeId
      return { tabs: newTabs, activeId: newActiveId }
    }

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
        insertIdx = i + 1
        break
      }
    }
    newTabs.splice(insertIdx, 0, tab)
  } else {
    newTabs.push(tab)
  }
  return { tabs: newTabs, activeId: tab.id }
}

// ── default config ────────────────────────────────────────────────────────────
const defaultConfig: AppConfig = {
  default_directory: '', indent_guides: false, order_directory: false,
  minimap: false, theme: 'dark', show_timestamps: false,
  git_recognition: { show_git_branch: false }, soft_close: false,
  zoom_insights: true, minimal_pwd: false, default_zoom: 1, command_alignment: 'default',
  terminal_word_wrap: false, file_word_wrap: false, scroll_speed: 1,
  preferred_shell: '', database_privacy: false,
}

const initialTab = makeTerminalTab()
const initialState: TabState = { tabs: [initialTab], activeId: initialTab.id }

const DIVIDER_PX = 4

interface PluginErrorBoundaryProps {
  pluginName: string
  children: React.ReactNode
}

interface PluginErrorBoundaryState {
  error: Error | null
}

class PluginErrorBoundary extends React.Component<PluginErrorBoundaryProps, PluginErrorBoundaryState> {
  state: PluginErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): PluginErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error(`[plugins] ${this.props.pluginName} crashed`, error)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="h-full flex items-center justify-center p-6 bg-[var(--app-bg)]">
          <div className="max-w-[720px] w-full border border-sep rounded-[18px] p-5 bg-[rgba(255,255,255,0.03)] text-[var(--tab-color)] font-mono">
            <div className="text-[12px] tracking-[0.12em] uppercase opacity-60 mb-2">
              Plugin Error
            </div>
            <div className="text-[18px] font-bold mb-2.5">
              {this.props.pluginName} failed to render
            </div>
            <div className="text-[12px] leading-[1.7] opacity-[0.82] whitespace-pre-wrap">
              {this.state.error.message}
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

export default function App() {
  const [state, dispatch] = useReducer(tabReducer, initialState)
  const { tabs, activeId } = state

  useDragRegions()

  // ── per-panel state ──────────────────────────────────────────────────────────
  const [tabPanels,      setTabPanels]      = useState<Record<string, 'left' | 'right'>>({})
  const [rightActiveId,  setRightActiveId]  = useState('')
  const [focusedPanel,   setFocusedPanel]   = useState<'left' | 'right'>('left')
  const [splitEnabled,   setSplitEnabled]   = useState(false)
  const [splitRatio,     setSplitRatio]     = useState(0.5)
  const [searchOpen,     setSearchOpen]     = useState(false)
  const [splitModalOpen, setSplitModalOpen] = useState(false)
  const [terminalCwds,   setTerminalCwds]   = useState<Record<string, string>>({})
  const [activePage,     setActivePage]     = useState<PageId>('terminal')
  const [panelSplitAxis, setPanelSplitAxis] = useState<'h' | 'v' | null>(null)
  const [panelBPage,     setPanelBPage]     = useState<PageId | null>(null)
  const [forcedDbPath,   setForcedDbPath]   = useState<string | undefined>()
  const [plugins,        setPlugins]        = useState<Record<string, Plugin>>({})
  const [pluginCommands, setPluginCommands] = useState<Record<string, InstalledPluginCommand>>({})

  const contentRef    = useRef<HTMLDivElement>(null)
  const dragging      = useRef(false)
  const pathDwellRef  = useRef<Map<string, { path: string; enteredAt: number; relatedPageVisited: boolean }>>(new Map())

  // ── plugin loader ─────────────────────────────────────────────────────────────
  const reloadPlugins = useCallback(async () => {
    if (!__PLUGINS__) return
    bootstrapBuiltins()
    const loaded = await loadInstalledPlugins().catch(() => [] as Plugin[])
    const map: Record<string, Plugin> = {}
    for (const p of loaded) {
      if (p.tabType) map[p.tabType] = p
    }
    setPlugins(map)
    setPluginCommands(buildInstalledPluginCommandMap(loaded))
  }, [])

  useEffect(() => { void reloadPlugins() }, [reloadPlugins])

  const leftTabs = useMemo(
    () => tabs.filter(t => (tabPanels[t.id] ?? 'left') === 'left'),
    [tabs, tabPanels]
  )
  const rightTabs = useMemo(
    () => tabs.filter(t => tabPanels[t.id] === 'right'),
    [tabs, tabPanels]
  )

  // Only terminal tabs appear in the header tab bar
  const terminalTabs = useMemo(() => tabs.filter(t => t.type === 'terminal'), [tabs])

  // ── app config ───────────────────────────────────────────────────────────────
  const [appConfig,   setAppConfig]   = useState<AppConfig>(defaultConfig)
  const [currentZoom, setCurrentZoom] = useState(() => {
    const saved = parseFloat(localStorage.getItem('cmdide_zoom') ?? '')
    return isFinite(saved) && saved > 0 ? saved : defaultConfig.default_zoom
  })
  const [liveColors,  setLiveColors]  = useState<Record<string, string> | null>(null)
  const [updateTag,   setUpdateTag]   = useState<string>('')

  const resolvedTheme = useMemo(() => {
    if (liveColors) return customColorsToTheme(liveColors)
    if (appConfig.theme === 'custom' && appConfig.custom_theme && Object.keys(appConfig.custom_theme).length > 0) {
      return customColorsToTheme(appConfig.custom_theme)
    }
    return getTheme(appConfig.theme)
  }, [liveColors, appConfig.theme, appConfig.custom_theme])

  // ── cleanup stale tabPanels entries when tabs close ──────────────────────────
  useEffect(() => {
    const valid = new Set(tabs.map(t => t.id))
    setTabPanels(prev => {
      const next: Record<string, 'left' | 'right'> = {}
      let changed = false
      for (const [id, panel] of Object.entries(prev)) {
        if (valid.has(id)) { next[id] = panel } else { changed = true }
      }
      return changed ? next : prev
    })
  }, [tabs])

  // ── update rightActiveId when right-panel active tab is closed ───────────────
  useEffect(() => {
    if (!rightActiveId) return
    if (tabs.find(t => t.id === rightActiveId)) return
    const nextRight = rightTabs.find(t => t.id !== rightActiveId)
    if (nextRight) {
      setRightActiveId(nextRight.id)
    } else {
      setRightActiveId('')
      setSplitEnabled(false)
    }
  }, [tabs, rightActiveId, rightTabs])

  // ── config load ──────────────────────────────────────────────────────────────
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
      setAppConfig(cfg)
      setCurrentZoom(zoom)
      localStorage.setItem('cmdide_zoom', String(zoom))
      setLiveColors(null)
    })
    return () => EventsOff('app:config')
  }, [])

  // ── session restore ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!appConfig.soft_close) return
    LoadSession().then(async (sessionTabs) => {
      if (!sessionTabs || sessionTabs.length === 0) return
      const restoredTabs: Tab[] = []
      let lastTerminalId: string | undefined

      for (const st of sessionTabs) {
        if (st.type === 'terminal') {
          const tab = makeTerminalTab(undefined, st.cwd || undefined)
          lastTerminalId = tab.id
          restoredTabs.push(tab)
        } else if (st.type === 'editor' && st.file_path) {
          try {
            const content = await ReadFile(st.file_path)
            const fileName = st.file_path.replace(/\\/g, '/').split('/').pop() ?? st.file_path
            restoredTabs.push({
              id: nextId(), type: 'editor', title: fileName,
              filePath: st.file_path, content,
              language: st.language || 'plaintext', parentId: lastTerminalId,
            })
          } catch { /* file gone */ }
        }
      }
      if (restoredTabs.length > 0) dispatch({ type: 'restore-session', tabs: restoredTabs })
    }).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appConfig.soft_close])

  // ── theme CSS vars ───────────────────────────────────────────────────────────
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
      setActivePage('database')
    })
    return () => EventsOff('app:open-database')
  }, [])

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
      const payload: OpenPreviewPayload = { type: 'url', url, path: url, terminalId: tabId }
      dispatch({ type: 'open-preview', payload })
    }
    window.addEventListener('ide:open-url', handler)
    return () => window.removeEventListener('ide:open-url', handler)
  }, [])

  useEffect(() => {
    EventsOn('app:open-problems', (...args: any[]) => {
      const payload = args[0] as OpenProblemsPayload
      if (!payload?.cwd) return
      setActivePage('debug')
    })
    return () => EventsOff('app:open-problems')
  }, [])

  useEffect(() => {
    EventsOn('app:open-config', () => {
      setActivePage('settings')
    })
    return () => EventsOff('app:open-config')
  }, [])

  useEffect(() => {
    EventsOn('app:open-tab', (...args: any[]) => {
      const p = args[0] as { type: string; title: string; terminalId?: string; cwd?: string }
      if (!p?.type) return
      if (p.type === 'plugins') {
        if (!__PLUGINS__) return
        setActivePage('plugins')
        return
      }
      if (p.type === 'fullscreen') {
        setActivePage('editor')
        return
      }
      dispatch({ type: 'open-tab', tabType: p.type, title: p.title, terminalId: p.terminalId, cwd: p.cwd })
    })
    return () => EventsOff('app:open-tab')
  }, [])

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

  // ── keyboard shortcuts ────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && (e.key === 'k' || e.key === '`')) { e.preventDefault(); setSearchOpen(v => !v) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // ── quit ─────────────────────────────────────────────────────────────────────
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

  // ── tab select ────────────────────────────────────────────────────────────────
  const handleLeftSelect = useCallback((id: string) => {
    dispatch({ type: 'select', id })
    setFocusedPanel('left')
    setActivePage('terminal')
  }, [])

  const _handleRightSelect = useCallback((id: string) => {
    setRightActiveId(id)
    setFocusedPanel('right')
    setActivePage('terminal')
  }, [])

  // ── move to right panel ───────────────────────────────────────────────────────
  const handleMoveRight = useCallback((id: string) => {
    const current = tabPanels[id] ?? 'left'
    if (current === 'right') return

    if (id === activeId) {
      const otherLeft = leftTabs.find(t => t.id !== id)
      if (otherLeft) dispatch({ type: 'select', id: otherLeft.id })
    }
    setTabPanels(prev => ({ ...prev, [id]: 'right' }))
    setRightActiveId(id)
    setSplitEnabled(true)
    setFocusedPanel('right')
  }, [tabPanels, activeId, leftTabs])

  // ── move to left panel ────────────────────────────────────────────────────────
  const handleMoveLeft = useCallback((id: string) => {
    const current = tabPanels[id] ?? 'left'
    if (current === 'left') return

    setTabPanels(prev => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    dispatch({ type: 'select', id })
    setFocusedPanel('left')

    const remaining = rightTabs.filter(t => t.id !== id)
    if (remaining.length === 0) {
      setSplitEnabled(false)
      setRightActiveId('')
    } else if (rightActiveId === id) {
      setRightActiveId(remaining[0].id)
    }
  }, [tabPanels, rightTabs, rightActiveId])

  const _handleTabDrop = useCallback((tabId: string, targetPanel: 'left' | 'right') => {
    const current = tabPanels[tabId] ?? 'left'
    if (current === targetPanel) return
    if (targetPanel === 'right') handleMoveRight(tabId)
    else handleMoveLeft(tabId)
  }, [tabPanels, handleMoveRight, handleMoveLeft])

  const _handleCloseOthers = useCallback((id: string) => {
    const panel = tabPanels[id] ?? 'left'
    const samePanel = tabs.filter(t => (tabPanels[t.id] ?? 'left') === panel && t.id !== id)
    for (const t of samePanel) {
      dispatch({ type: 'close', id: t.id })
    }
    if (panel === 'left') {
      dispatch({ type: 'select', id })
    } else {
      setRightActiveId(id)
    }
  }, [tabs, tabPanels])

  const _handleRightClose = useCallback((id: string) => {
    dispatch({ type: 'close', id })
  }, [])

  const _handleAddSiblingTerminal = useCallback(async (parentId: string) => {
    const cwd   = await GetTerminalCwd(parentId).catch(() => '')
    const panel = tabPanels[parentId] ?? 'left'

    if (panel === 'right') {
      const newId = nextId()
      dispatch({ type: 'add-terminal', id: newId, parentId, initialCwd: cwd || undefined, keepActive: true })
      setTabPanels(prev => ({ ...prev, [newId]: 'right' }))
      setRightActiveId(newId)
    } else {
      dispatch({ type: 'add-terminal', parentId, initialCwd: cwd || undefined })
    }
    setActivePage('terminal')
  }, [tabPanels])

  const handleRightNewTerminal = useCallback(() => {
    const newId = nextId()
    dispatch({ type: 'add-terminal', id: newId, keepActive: true })
    setTabPanels(prev => ({ ...prev, [newId]: 'right' }))
    setRightActiveId(newId)
    setFocusedPanel('right')
  }, [])

  const handleNewTab = useCallback(() => {
    dispatch({ type: 'add-terminal' })
    setActivePage('terminal')
  }, [])

  const handleDuplicateTab = useCallback(async (id: string) => {
    const cwd   = await GetTerminalCwd(id).catch(() => '')
    const panel = tabPanels[id] ?? 'left'
    if (panel === 'right') {
      const newId = nextId()
      dispatch({ type: 'add-terminal', id: newId, parentId: id, initialCwd: cwd || undefined, keepActive: true })
      setTabPanels(prev => ({ ...prev, [newId]: 'right' }))
      setRightActiveId(newId)
    } else {
      dispatch({ type: 'add-terminal', parentId: id, initialCwd: cwd || undefined })
    }
    setActivePage('terminal')
  }, [tabPanels])

  // ── theme helpers ─────────────────────────────────────────────────────────────
  const handleApplyColors = useCallback((colors: Record<string, string>) => {
    setLiveColors(colors)
  }, [])

  const handleSaveTheme = useCallback(async (colors: Record<string, string>) => {
    await SaveCustomTheme(colors)
  }, [])

  const handleSaveSettings = useCallback(async (cfg: AppConfig) => {
    await SaveAppConfig(cfg as unknown as Parameters<typeof SaveAppConfig>[0])
    setAppConfig(cfg)
  }, [])

  // ── panel split ──────────────────────────────────────────────────────────────

  const closePanelB = useCallback(() => {
    setPanelSplitAxis(null)
    setPanelBPage(null)
  }, [])

  const handleSidebarNavigate = useCallback((page: PageId) => {
    if (page === 'terminal') {
      const current = tabs.find(t => t.id === activeId)
      if (current?.type === 'ports') {
        const parent = tabs.find(t => t.id === current.parentId && t.type === 'terminal')
          ?? tabs.find(t => t.type === 'terminal')
        if (parent && parent.id !== activeId) {
          dispatch({ type: 'select', id: parent.id })
          setFocusedPanel('left')
        }
      }
    }
    setActivePage(page)
    if (page === panelBPage) closePanelB()
  }, [tabs, activeId, panelBPage, closePanelB])

  const handlePanelMove = useCallback((page: PageId, dir: 'left' | 'right' | 'up' | 'down') => {
    if (dir === 'right' || dir === 'down') {
      // Page goes into Panel B (right or bottom slot)
      setPanelSplitAxis(dir === 'right' ? 'h' : 'v')
      setPanelBPage(page)
    } else {
      // Page goes into Panel A (left or top slot)
      setActivePage(page)
      if (page === panelBPage) {
        closePanelB()
      } else if (panelBPage) {
        // Already have a Panel B — keep it, just change axis
        setPanelSplitAxis(dir === 'left' ? 'h' : 'v')
      }
    }
  }, [panelBPage, closePanelB])

  // ── derive active terminal ID ────────────────────────────────────────────────
  const activeTerminalId = useMemo(() => {
    const focused = focusedPanel === 'left' ? activeId : rightActiveId
    const tab = tabs.find(t => t.id === focused)
    if (tab?.type === 'terminal') return tab.id
    return tabs.find(t => t.type === 'terminal')?.id ?? null
  }, [focusedPanel, activeId, rightActiveId, tabs])

  // The terminal tab that should be highlighted in the tab bar
  const activeTerminalTabId = useMemo(() => {
    if (!activeTerminalId) return activeId
    return activeTerminalId
  }, [activeTerminalId, activeId])

  const activeCwd = useMemo(() => {
    if (!activeTerminalId) return ''
    return terminalCwds[activeTerminalId] ?? ''
  }, [activeTerminalId, terminalCwds])

  // ── tab assign ────────────────────────────────────────────────────────────────
  const handleTabAssign = useCallback((tabId: string, panel: 'left' | 'right') => {
    if (panel === 'right') handleMoveRight(tabId)
    else handleMoveLeft(tabId)
  }, [handleMoveRight, handleMoveLeft])

  // ── problems helpers ──────────────────────────────────────────────────────────
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
    } catch { /* file gone */ }
  }, [])

  useEffect(() => {
    const handler = (e: Event) => {
      const { path } = (e as CustomEvent<{ path: string }>).detail
      if (path) void handleOpenFileAtLine(path, 0, 0)
    }
    window.addEventListener('ide:ctrl-click-file', handler)
    return () => window.removeEventListener('ide:ctrl-click-file', handler)
  }, [handleOpenFileAtLine])

  // ── divider drag ──────────────────────────────────────────────────────────────
  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current || !contentRef.current) return
      const rect = contentRef.current.getBoundingClientRect()
      const ratio = (ev.clientX - rect.left) / rect.width
      setSplitRatio(Math.max(0.2, Math.min(0.8, ratio)))
    }
    const onUp = () => {
      dragging.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  // ── render tab content (for terminal panels) ──────────────────────────────────
  function renderTabContent(tab: Tab, isLeft: boolean) {
    const isActive = isLeft ? tab.id === activeId : tab.id === rightActiveId

    if (tab.type === 'terminal') {
      return (
        <Terminal
          tabId={tab.id}
          active={isActive && activePage === 'terminal'}
          xtermTheme={resolvedTheme.xtermTheme}
          initialCwd={tab.initialCwd}
          defaultZoom={currentZoom}
          commandAlignment={(appConfig.command_alignment as 'default' | 'top' | 'bottom') ?? 'default'}
          pluginCommands={pluginCommands}
          quickPaths={loadRecentPaths()}
          onCwdChange={cwd => {
            setTerminalCwds(prev => ({ ...prev, [tab.id]: cwd }))
            const prev = pathDwellRef.current.get(tab.id)
            if (prev && prev.path !== cwd) {
              const dwell = Date.now() - prev.enteredAt
              if (dwell >= 60000 || prev.relatedPageVisited) {
                saveRecentPath(prev.path)
              }
            }
            pathDwellRef.current.set(tab.id, { path: cwd, enteredAt: Date.now(), relatedPageVisited: false })
          }}
        />
      )
    }
    if (tab.type === 'editor') {
      return (
        <Editor
          tabId={tab.id}
          filePath={tab.filePath!}
          content={tab.content ?? ''}
          language={tab.language ?? 'plaintext'}
          active={isActive}
          indentGuides={appConfig.indent_guides}
          monacoTheme={resolvedTheme.monacoThemeId}
          monacoThemeDef={resolvedTheme.monacoThemeDef}
          minimap={appConfig.minimap}
          defaultZoom={currentZoom}
          gotoLine={tab.gotoLine}
        />
      )
    }
    if (tab.type === 'database') return <Database dbPath={tab.dbPath!} privacyMode={appConfig.database_privacy} />
    if (tab.type === 'problems') {
      return (
        <Problems
          tabId={tab.id}
          cwd={tab.problemsCwd!}
          sources={tab.problemsSources ?? []}
          items={tab.problemsItems ?? []}
          scanning={false}
          onRescan={(id, cwd) => { void handleRescanProblems(id, cwd) }}
          onOpenFile={(path, line, col) => { void handleOpenFileAtLine(path, line, col) }}
        />
      )
    }
    if (tab.type === 'preview') {
      return (
        <Preview
          previewType={tab.previewType!}
          src={tab.previewSrc!}
          path={tab.previewPath!}
        />
      )
    }
    if (tab.type === 'ports') return <PortsTab tabId={tab.id} active={isActive} />
    if (tab.type === 'perf')  return <PerfTab  tabId={tab.id} active={isActive} />
    if (tab.type === 'plugins') {
      if (!__PLUGINS__) return null
      return <PluginStore onPluginChange={reloadPlugins} />
    }
    if (!__PLUGINS__) return null
    const plugin = plugins[tab.type]
    if (plugin?.TabComponent) {
      const context: PluginContext = {
        terminalId: tab.parentId,
        cwd: tab.meta?.cwd,
        executeCommand: tab.parentId
          ? (cmd: string) => window.dispatchEvent(
              new CustomEvent('plugin:execute', { detail: { terminalId: tab.parentId, cmd } })
            )
          : undefined,
        openFile: (path: string) => handleOpenFileAtLine(path, 0, 0),
      }
      return (
        <PluginErrorBoundary pluginName={plugin.name}>
          <plugin.TabComponent tabId={tab.id} active={isActive} context={context} />
        </PluginErrorBoundary>
      )
    }
    return null
  }

  // ── Path dwell: mark related page visits ─────────────────────────────────────
  useEffect(() => {
    if (activePage === 'debug' || activePage === 'database' || activePage === 'editor') {
      pathDwellRef.current.forEach(entry => {
        entry.relatedPageVisited = true
      })
    }
  }, [activePage])

  // ── ProblemsPage inline state ─────────────────────────────────────────────────
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
        setProbSources(r.sources ?? [])
        setProbItems(r.items ?? [])
      })
      .catch(() => {})
      .finally(() => setProbScanning(false))
  }, [activePage, activeCwd])

  useEffect(() => { setProbItems([]); setProbSources([]) }, [activeCwd])
  useEffect(() => { setCweItems([]) }, [activeCwd])

  const handleCweScan = useCallback(async (scanCwd: string) => {
    setCweScanning(true)
    try {
      const result = await ScanCWE(scanCwd)
      setCweItems(Array.isArray(result) ? result as CweItem[] : [])
    } catch { /* ignore */ }
    setCweScanning(false)
  }, [])

  // ── render ────────────────────────────────────────────────────────────────────
  const wcBtnBase = "flex items-center justify-center w-8 h-[26px] rounded-sm bg-transparent border-0 cursor-pointer text-[var(--tab-color)] transition-[background,color] duration-[100ms] p-0"

  return (
    <div className="flex flex-col w-screen h-screen overflow-hidden bg-[var(--app-bg)] font-ui" onContextMenu={e => e.preventDefault()}>

      {/* ── App header ──────────────────────────────────────────────────────────── */}
      <div className="flex h-[42px] shrink-0 bg-[var(--app-bg)] border-b border-[var(--border-color)] select-none">
        {/* Brand/logo placeholder — matches sidebar width, reserved for future branding */}
        <div
          className="w-[48px] shrink-0 border-r border-[var(--border-color)]"
          style={{ ['--wails-draggable' as any]: 'no-drag' }}
        />
        {/* Navigation bar */}
        <div
          className="flex-1 flex items-center overflow-hidden"
          style={{ ['--wails-draggable' as any]: 'drag' }}
          onDoubleClick={WindowToggleMaximise}
        >
        {/* Left: terminal tab bar (flex-1, scrollable) */}
        <div
          className="flex-1 min-w-0 h-full overflow-hidden"
          style={{ ['--wails-draggable' as any]: 'no-drag' }}
        >
          <TabBar
            panel="left"
            tabs={terminalTabs}
            activeId={activeTerminalTabId}
            focused={focusedPanel === 'left'}
            onSelect={handleLeftSelect}
            onClose={id => dispatch({ type: 'close', id })}
            onCloseOthers={_handleCloseOthers}
            onMoveRight={handleMoveRight}
            onMoveLeft={handleMoveLeft}
            onNewTerminal={handleNewTab}
            onAddSiblingTerminal={id => { void _handleAddSiblingTerminal(id) }}
            onDrop={id => _handleTabDrop(id, 'left')}
            onDuplicate={id => { void handleDuplicateTab(id) }}
            onRename={(id, title) => dispatch({ type: 'rename-tab', id, title })}
            onSetColor={(id, color) => dispatch({ type: 'set-tab-color', id, color })}
          />
        </div>

        {/* Right: split, update badge, window controls */}
        <div className="flex items-center gap-0.5 px-1.5 shrink-0" style={{ ['--wails-draggable' as any]: 'no-drag' }}>

          {/* Split view */}
          <button
            className={"flex items-center justify-center w-[26px] h-[26px] rounded-md bg-transparent border-0 cursor-pointer transition-[background,color] duration-[100ms] p-0 hover:bg-surface-raised hover:text-[var(--tab-color-hover)]" + (splitEnabled ? ' text-accent' : ' text-[var(--tab-color)]')}
            onClick={() => setSplitModalOpen(true)}
            title="Arrange split view layout"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <rect x="1" y="1" width="6" height="6" rx="1.2"/>
              <rect x="9" y="1" width="6" height="6" rx="1.2"/>
              <rect x="1" y="9" width="6" height="6" rx="1.2"/>
              <rect x="9" y="9" width="6" height="6" rx="1.2"/>
            </svg>
          </button>

          {/* Update badge */}
          {updateTag && (
            <button
              className="flex items-center justify-center w-[26px] h-[26px] border-0 rounded p-0 bg-transparent text-[#3fb950] cursor-pointer shrink-0 transition-[background,color] duration-[120ms] hover:bg-[rgba(63,185,80,0.15)] hover:text-[#56d364]"
              title={`Update available: ${updateTag} — click to install`}
              onClick={() => PerformUpdate(updateTag).catch(() => {})}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M8 2v9M5 8l3 3 3-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M3 13h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
              </svg>
            </button>
          )}

          <div className="w-px h-4 bg-sep shrink-0 mx-0.5" />

          {/* Window controls */}
          <div className="flex items-center gap-0.5">
            <button className={wcBtnBase + " hover:text-[var(--tab-color-hover)] hover:bg-surface-raised"} onClick={WindowMinimise} aria-label="Minimise">
              <svg width="10" height="2" viewBox="0 0 10 2">
                <path d="M0 1h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
            <button className={wcBtnBase + " hover:text-[var(--tab-color-hover)] hover:bg-surface-raised"} onClick={WindowToggleMaximise} aria-label="Maximise">
              <svg width="10" height="10" viewBox="0 0 10 10">
                <rect x="0.75" y="0.75" width="8.5" height="8.5" rx="1.5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
              </svg>
            </button>
            <button className={wcBtnBase + " hover:bg-error hover:text-white"} onClick={handleQuit} aria-label="Close">
              <svg width="10" height="10" viewBox="0 0 10 10">
                <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        </div>
        </div>
      </div>

      {/* ── Modals ───────────────────────────────────────────────────────────────── */}
      <SplitModal
        open={splitModalOpen}
        tabs={tabs}
        tabPanels={tabPanels}
        splitEnabled={splitEnabled}
        terminalCwds={terminalCwds}
        onAssign={handleTabAssign}
        onSetSplit={enabled => {
          setSplitEnabled(enabled)
          if (enabled && rightTabs.length === 0) handleRightNewTerminal()
        }}
        onDismiss={() => setSplitModalOpen(false)}
      />

      {searchOpen && (
        <SearchPalette
          tabs={tabs}
          activeTerminalId={activeTerminalId}
          onSelectTab={id => { handleLeftSelect(id); setSearchOpen(false) }}
          onOpenFile={(path, line) => { void handleOpenFileAtLine(path, line ?? 0, 0); setActivePage('terminal'); setSearchOpen(false) }}
          onClose={() => setSearchOpen(false)}
        />
      )}

      <ZoomIndicator
        enabled={appConfig.zoom_insights}
        defaultZoom={appConfig.default_zoom}
        onZoomChange={setCurrentZoom}
      />

      {/* ── Body: sidebar + content ───────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden flex">

        {/* Sidebar */}
        <Sidebar
          activePage={activePage}
          onNavigate={handleSidebarNavigate}
          onSearch={() => setSearchOpen(true)}
          onPanelMove={handlePanelMove}
          onOpenPorts={() => {
            dispatch({ type: 'open-tab', tabType: 'ports', title: 'ports', terminalId: activeTerminalId ?? undefined })
            setActivePage('terminal')
          }}
          showPlugins={__PLUGINS__}
        />

        {/* Content — supports optional side-by-side or top/bottom panel split */}
        <div className={`flex-1 overflow-hidden ${panelSplitAxis ? `flex ${panelSplitAxis === 'v' ? 'flex-col' : 'flex-row'}` : 'relative'}`}>

          {/* ── Panel A (primary — always present) ────────────────────────────── */}
          <div className={`${panelSplitAxis ? 'flex-1 relative' : 'absolute inset-0'} overflow-hidden`} ref={contentRef}>

            {/* Terminal panels — always mounted, hidden when a page is active */}
            <div
              className="absolute inset-0"
              style={{
                visibility:    activePage === 'terminal' ? 'visible' : 'hidden',
                pointerEvents: activePage === 'terminal' ? 'auto'    : 'none',
              }}
            >
              {tabs.map(tab => {
                const panel    = tabPanels[tab.id] ?? 'left'
                const isLeft   = panel === 'left'
                const isActive = isLeft ? tab.id === activeId : tab.id === rightActiveId
                const visible  = isActive && (isLeft || splitEnabled)

                let style: React.CSSProperties
                if (!visible) {
                  style = { display: 'none', left: 0, right: 0 }
                } else if (!splitEnabled) {
                  style = { display: 'flex', left: 0, right: 0 }
                } else if (isLeft) {
                  style = {
                    display: 'flex',
                    left: 0,
                    width: `calc(${splitRatio * 100}% - ${DIVIDER_PX / 2}px)`,
                  }
                } else {
                  style = {
                    display: 'flex',
                    left: `calc(${splitRatio * 100}% + ${DIVIDER_PX / 2}px)`,
                    right: 0,
                  }
                }

                const isFocused = splitEnabled && (isLeft ? focusedPanel === 'left' : focusedPanel === 'right')

                return (
                  <div
                    key={tab.id}
                    className={`absolute top-0 bottom-0 flex flex-col overflow-hidden${isFocused ? ' pane--focused' : ''}`}
                    style={style}
                    onMouseDown={() => setFocusedPanel(isLeft ? 'left' : 'right')}
                  >
                    {renderTabContent(tab, isLeft)}
                  </div>
                )
              })}

              {splitEnabled && (
                <div
                  className="absolute top-0 bottom-0 w-[4px] cursor-col-resize bg-[var(--border-color)] z-20 transition-[background] duration-[180ms] hover:bg-[rgba(10,132,255,0.5)] active:bg-[rgba(10,132,255,0.5)]"
                  style={{ left: `calc(${splitRatio * 100}% - ${DIVIDER_PX / 2}px)` }}
                  onMouseDown={handleDividerMouseDown}
                />
              )}
            </div>

            {/* Page overlay — Panel A */}
            {activePage !== 'terminal' && (
              <div className="absolute inset-0 bg-[var(--app-bg)] flex flex-col overflow-hidden">
                {activePage === 'editor' && (
                  <FullscreenIDE
                    cwd={activeCwd}
                    theme={resolvedTheme}
                    indentGuides={appConfig.indent_guides}
                    minimap={appConfig.minimap}
                    wordWrap={appConfig.file_word_wrap}
                    defaultZoom={currentZoom}
                  />
                )}
                {activePage === 'database' && (
                  <DatabasePage
                    key={activeTerminalId ?? 'no-terminal'}
                    terminalId={activeTerminalId}
                    cwd={activeCwd}
                    initialDbPath={forcedDbPath}
                    privacyMode={appConfig.database_privacy}
                  />
                )}
                {activePage === 'debug' && (
                  <Problems
                    tabId={activeTerminalId ?? 'problems-page'}
                    cwd={activeCwd}
                    sources={probSources}
                    items={probItems}
                    scanning={probScanning}
                    cweItems={cweItems}
                    cweScanning={cweScanning}
                    onRescan={async (_, scanCwd) => {
                      setProbScanning(true)
                      try {
                        const r = await ScanProblems(scanCwd) as { sources?: string[]; items?: ProbItem[] }
                        setProbSources(r.sources ?? [])
                        setProbItems(r.items ?? [])
                      } catch { /* ignore */ }
                      setProbScanning(false)
                    }}
                    onOpenFile={(path, line, col) => {
                      void handleOpenFileAtLine(path, line, col)
                      setActivePage('terminal')
                    }}
                    onCweScan={cwd => { void handleCweScan(cwd) }}
                  />
                )}
                {activePage === 'settings' && (
                  <ConfigEditor
                    appConfig={appConfig}
                    onSaveSettings={handleSaveSettings}
                    onApply={handleApplyColors}
                    onSaveTheme={handleSaveTheme}
                  />
                )}
                {activePage === 'plugins' && __PLUGINS__ && (
                  <PluginStore onPluginChange={reloadPlugins} />
                )}
              </div>
            )}
          </div>

          {/* ── Panel B (secondary — only when split is active) ────────────────── */}
          {panelSplitAxis && panelBPage && (
            <>
              {/* Split divider */}
              <div className={panelSplitAxis === 'h'
                ? 'w-[1px] bg-[var(--border-color)] shrink-0'
                : 'h-[1px] bg-[var(--border-color)] shrink-0'}
              />

              {/* Panel B container */}
              <div className="flex-1 overflow-hidden flex flex-col">

                {/* Panel B header */}
                <div className="flex items-center justify-between h-[28px] px-3 bg-[var(--info-bar-bg)] border-b border-[var(--border-color)] shrink-0 select-none">
                  <span className="text-[10.5px] font-ui font-semibold uppercase tracking-[0.07em] text-[var(--info-bar-color)]">
                    {{ editor: 'Code Editor', database: 'Database', debug: 'Debug', settings: 'Settings', plugins: 'Plugins', terminal: 'Terminal' }[panelBPage] ?? panelBPage}
                  </span>
                  <button
                    className="flex items-center justify-center w-5 h-5 rounded bg-transparent border-0 cursor-pointer text-[var(--info-bar-color)] transition-[background,color] duration-[100ms] hover:text-[var(--tab-color-hover)] hover:bg-surface-raised"
                    onClick={closePanelB}
                    title="Close panel"
                  >
                    <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                      <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                    </svg>
                  </button>
                </div>

                {/* Panel B page content */}
                <div className="flex-1 overflow-hidden relative">
                  {panelBPage === 'editor' && (
                    <FullscreenIDE
                      cwd={activeCwd}
                      theme={resolvedTheme}
                      indentGuides={appConfig.indent_guides}
                      minimap={appConfig.minimap}
                      wordWrap={appConfig.file_word_wrap}
                      defaultZoom={currentZoom}
                    />
                  )}
                  {panelBPage === 'database' && (
                    <DatabasePage
                      key={activeTerminalId ?? 'no-terminal'}
                      terminalId={activeTerminalId}
                      cwd={activeCwd}
                      privacyMode={appConfig.database_privacy}
                    />
                  )}
                  {panelBPage === 'debug' && (
                    <Problems
                      tabId={(activeTerminalId ?? 'problems-panelb') + '-b'}
                      cwd={activeCwd}
                      sources={probSources}
                      items={probItems}
                      scanning={probScanning}
                      cweItems={cweItems}
                      cweScanning={cweScanning}
                      onRescan={async (_, scanCwd) => {
                        setProbScanning(true)
                        try {
                          const r = await ScanProblems(scanCwd) as { sources?: string[]; items?: ProbItem[] }
                          setProbSources(r.sources ?? [])
                          setProbItems(r.items ?? [])
                        } catch { /* ignore */ }
                        setProbScanning(false)
                      }}
                      onOpenFile={(path, line, col) => {
                        void handleOpenFileAtLine(path, line, col)
                        setActivePage('terminal')
                        closePanelB()
                      }}
                      onCweScan={cwd => { void handleCweScan(cwd) }}
                    />
                  )}
                  {panelBPage === 'settings' && (
                    <ConfigEditor
                      appConfig={appConfig}
                      onSaveSettings={handleSaveSettings}
                      onApply={handleApplyColors}
                      onSaveTheme={handleSaveTheme}
                    />
                  )}
                  {panelBPage === 'plugins' && __PLUGINS__ && (
                    <PluginStore onPluginChange={reloadPlugins} />
                  )}
                </div>
              </div>
            </>
          )}
        </div>
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
