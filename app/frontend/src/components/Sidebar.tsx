import React, { useState, useEffect, useRef } from 'react'
import ReactDOM from 'react-dom'

export type PageId = 'terminal' | 'editor' | 'database' | 'debug' | 'settings' | 'plugins'

interface Props {
  activePage:   PageId
  onNavigate:   (page: PageId) => void
  onSearch:     () => void
  onPanelMove:  (page: PageId, dir: 'left' | 'right' | 'up' | 'down') => void
  showPlugins:  boolean
}

// ── Icons ─────────────────────────────────────────────────────────────────────

const TerminalIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="20" height="18" rx="3"/>
    <path d="M7 9l4 3-4 3"/>
    <path d="M13 15h4"/>
  </svg>
)

const EditorIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="16" y1="13" x2="8" y2="13"/>
    <line x1="16" y1="17" x2="8" y2="17"/>
    <polyline points="10 9 9 9 8 9"/>
  </svg>
)

const DatabaseIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <ellipse cx="12" cy="5" rx="9" ry="3"/>
    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
  </svg>
)

const DebugIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 3a3 3 0 016 0"/>
    <path d="M9 3L7 1.5M15 3l2-1.5"/>
    <rect x="8" y="5.5" width="8" height="11" rx="4"/>
    <path d="M8 9.5H4M8 13H4M8.5 16.5L5 19"/>
    <path d="M16 9.5h4M16 13h4M15.5 16.5L19 19"/>
  </svg>
)

const SearchIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/>
    <line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
)

const SettingsIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
  </svg>
)

const PluginsIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 7h3a1 1 0 0 0 1-1v-1a2 2 0 0 1 4 0v1a1 1 0 0 0 1 1h3a1 1 0 0 1 1 1v3a1 1 0 0 0 1 1h1a2 2 0 0 1 0 4h-1a1 1 0 0 0-1 1v3a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-1a2 2 0 0 0-4 0v1a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a2 2 0 0 0 0-4h-1a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z"/>
  </svg>
)

// ── SidebarBtn ────────────────────────────────────────────────────────────────

interface BtnProps {
  active:          boolean
  label:           string
  onClick:         () => void
  onContextMenu?:  (e: React.MouseEvent) => void
  children:        React.ReactNode
}

function SidebarBtn({ active, label, onClick, onContextMenu, children }: BtnProps) {
  return (
    <button
      className={[
        'relative flex items-center justify-center w-10 h-10 rounded-md border-0 cursor-pointer transition-[background,color] duration-[100ms] shrink-0',
        active
          ? 'text-[var(--tab-color-hover)] bg-surface-overlay'
          : 'text-[var(--tab-color)] bg-transparent hover:text-[var(--tab-color-hover)] hover:bg-surface-raised',
      ].join(' ')}
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={label}
      aria-label={label}
    >
      {active && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-accent rounded-r-full" />
      )}
      {children}
    </button>
  )
}

// ── Context menu types ────────────────────────────────────────────────────────

interface CtxState { page: PageId; x: number; y: number }

// Terminal can only be the primary (left/top) panel — it can't move to a secondary slot
const TERMINAL_ONLY_PRIMARY: Set<PageId> = new Set(['terminal'])

// ── Main component ────────────────────────────────────────────────────────────

export default function Sidebar({ activePage, onNavigate, onSearch, onPanelMove, showPlugins }: Props) {
  const [ctx, setCtx]   = useState<CtxState | null>(null)
  const ctxRef          = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ctx) return
    const onDown = (e: MouseEvent) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) setCtx(null)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCtx(null) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [ctx])

  function openCtx(e: React.MouseEvent, page: PageId) {
    e.preventDefault()
    e.stopPropagation()
    const x = Math.min(e.clientX + 4, window.innerWidth  - 200)
    const y = Math.min(e.clientY,     window.innerHeight - 200)
    setCtx({ page, x, y })
  }

  function act(dir: 'left' | 'right' | 'up' | 'down') {
    if (!ctx) return
    onPanelMove(ctx.page, dir)
    setCtx(null)
  }

  // ── Context menu ───────────────────────────────────────────────────────────

  let ctxMenu: React.ReactNode = null
  if (ctx) {
    const isTerminal = TERMINAL_ONLY_PRIMARY.has(ctx.page)

    const menuItem = (
      icon:     React.ReactNode,
      label:    string,
      dir:      'left' | 'right' | 'up' | 'down',
      disabled: boolean,
      hint?:    string,
    ) => (
      <button
        key={dir}
        className={[
          'flex items-center gap-[9px] w-full px-[14px] py-[7px] bg-transparent border-0 text-left font-ui text-[12.5px] whitespace-nowrap transition-[background] duration-[100ms]',
          disabled
            ? 'opacity-30 cursor-not-allowed text-[var(--info-bar-color)]'
            : 'cursor-pointer text-[var(--info-bar-hover-color)] hover:bg-surface-raised',
        ].join(' ')}
        onClick={disabled ? undefined : () => act(dir)}
        title={hint}
        disabled={disabled}
      >
        <span className="opacity-60 flex items-center">{icon}</span>
        {label}
      </button>
    )

    const ArrowSvg = ({ d }: { d: string }) => (
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d={d}/>
      </svg>
    )

    ctxMenu = ReactDOM.createPortal(
      <div
        ref={ctxRef}
        className="fixed z-[9999] bg-[var(--info-bar-bg)] border border-sep-strong rounded-md py-1 min-w-[190px] shadow-overlay font-ui backdrop-blur-[16px]"
        style={{ left: ctx.x, top: ctx.y }}
        onContextMenu={e => e.preventDefault()}
      >
        <div className="px-[14px] py-[5px] text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--info-bar-color)] opacity-50 select-none border-b border-[var(--sep)] mb-1">
          Open alongside…
        </div>
        {menuItem(<ArrowSvg d="M7 1v12M3 5L7 1l4 4"/>,  'Move Up (top panel)',    'up',    false)}
        {menuItem(<ArrowSvg d="M7 13V1M3 9l4 4 4-4"/>,  'Move Down (bottom panel)', 'down', isTerminal, isTerminal ? 'Terminal stays in the primary panel' : undefined)}
        {menuItem(<ArrowSvg d="M1 7h12M5 3L1 7l4 4"/>,  'Move Left (left panel)', 'left',  false)}
        {menuItem(<ArrowSvg d="M13 7H1M9 3l4 4-4 4"/>,  'Move Right (right panel)', 'right', isTerminal, isTerminal ? 'Terminal stays in the primary panel' : undefined)}
      </div>,
      document.body,
    )
  }

  return (
    <>
      <div
        className="flex flex-col items-center w-[48px] shrink-0 bg-[var(--app-bg)] border-r border-[var(--border-color)] py-1.5 select-none"
        style={{ ['--wails-draggable' as any]: 'no-drag' }}
      >
        {/* Features */}
        <div className="flex flex-col items-center gap-0.5 flex-1">
          <SidebarBtn active={activePage === 'terminal'} label="Terminal"    onClick={() => onNavigate('terminal')} onContextMenu={e => openCtx(e, 'terminal')}>
            <TerminalIcon />
          </SidebarBtn>
          <SidebarBtn active={activePage === 'editor'}   label="Code Editor" onClick={() => onNavigate('editor')}   onContextMenu={e => openCtx(e, 'editor')}>
            <EditorIcon />
          </SidebarBtn>
          <SidebarBtn active={activePage === 'database'} label="Database"    onClick={() => onNavigate('database')} onContextMenu={e => openCtx(e, 'database')}>
            <DatabaseIcon />
          </SidebarBtn>
          <SidebarBtn active={activePage === 'debug'} label="Debug"    onClick={() => onNavigate('debug')} onContextMenu={e => openCtx(e, 'debug')}>
            <DebugIcon />
          </SidebarBtn>
          <SidebarBtn active={false} label="Search  (Ctrl+K)" onClick={onSearch}>
            <SearchIcon />
          </SidebarBtn>
        </div>

        {/* Utilities */}
        <div className="flex flex-col items-center gap-0.5">
          <div className="w-6 h-px bg-sep mb-1" />
          {showPlugins && (
            <SidebarBtn active={activePage === 'plugins'} label="Plugins" onClick={() => onNavigate('plugins')}>
              <PluginsIcon />
            </SidebarBtn>
          )}
          <SidebarBtn active={activePage === 'settings'} label="Settings" onClick={() => onNavigate('settings')}>
            <SettingsIcon />
          </SidebarBtn>
        </div>
      </div>

      {ctxMenu}
    </>
  )
}
