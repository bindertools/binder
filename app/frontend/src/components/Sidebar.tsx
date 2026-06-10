import React, { useState, useRef, useEffect } from 'react'
import ReactDOM from 'react-dom'
import type { PageId } from '../paneModel'

export type { PageId }

interface Props {
  activePage:      PageId
  onNavigate:      (page: PageId) => void
  onSearch:        () => void
  onStartPageDrag: (page: PageId, startX: number, startY: number) => void
  showPlugins:     boolean
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

const PortsIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22v-5"/>
    <path d="M9 7V2"/>
    <path d="M15 7V2"/>
    <path d="M6 7h12l-1 8a5 5 0 01-10 0L6 7z"/>
  </svg>
)

const VersionControlIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="6" cy="4" r="2"/>
    <circle cx="6" cy="20" r="2"/>
    <circle cx="18" cy="8" r="2"/>
    <path d="M6 6v12"/>
    <path d="M6 6c0 4 12 4 12 2"/>
  </svg>
)

const WorkflowsIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="5" cy="6" r="2.5"/>
    <circle cx="19" cy="6" r="2.5"/>
    <circle cx="12" cy="18" r="2.5"/>
    <path d="M7.2 7.3L10 16M16.8 7.3L14 16M7.5 6h9"/>
  </svg>
)

const PluginsIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 7h3a1 1 0 0 0 1-1v-1a2 2 0 0 1 4 0v1a1 1 0 0 0 1 1h3a1 1 0 0 1 1 1v3a1 1 0 0 0 1 1h1a2 2 0 0 1 0 4h-1a1 1 0 0 0-1 1v3a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-1a2 2 0 0 0-4 0v1a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a2 2 0 0 0 0-4h-1a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z"/>
  </svg>
)

// ── SidebarBtn ────────────────────────────────────────────────────────────────

interface BtnProps {
  active:       boolean
  label:        string
  onClick:      () => void
  onMouseDown?: (e: React.MouseEvent) => void
  children:     React.ReactNode
}

function SidebarBtn({ active, label, onClick, onMouseDown, children }: BtnProps) {
  const cursorCls = onMouseDown ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
  const [tooltipVisible, setTooltipVisible] = useState(false)
  const btnRef  = useRef<HTMLButtonElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showTooltip = () => {
    timerRef.current = setTimeout(() => setTooltipVisible(true), 350)
  }

  const hideTooltip = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    setTooltipVisible(false)
  }

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  const tooltipEl = tooltipVisible && btnRef.current
    ? ReactDOM.createPortal(
        (() => {
          const rect = btnRef.current!.getBoundingClientRect()
          return (
            <div
              className="fixed z-[9999] px-2.5 py-1 rounded-md bg-[var(--info-bar-bg)] border border-sep text-[11.5px] font-ui text-[var(--info-bar-hover-color)] shadow-overlay select-none pointer-events-none whitespace-nowrap"
              style={{ left: rect.right + 8, top: Math.round(rect.top + rect.height / 2), transform: 'translateY(-50%)' }}
            >
              {label}
            </div>
          )
        })(),
        document.body,
      )
    : null

  return (
    <>
      <button
        ref={btnRef}
        className={[
          `relative flex items-center justify-center w-10 h-10 rounded-md border-0 ${cursorCls} transition-[background,color] duration-[100ms] shrink-0`,
          active
            ? 'text-[var(--tab-color-hover)] bg-surface-overlay'
            : 'text-[var(--tab-color)] bg-transparent hover:text-[var(--tab-color-hover)] hover:bg-surface-raised',
        ].join(' ')}
        onClick={onClick}
        onMouseDown={onMouseDown}
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        aria-label={label}
      >
        {active && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-accent rounded-r-full" />
        )}
        {children}
      </button>
      {tooltipEl}
    </>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Sidebar({ activePage, onNavigate, onSearch, onStartPageDrag, showPlugins }: Props) {
  return (
    <div
      className="flex flex-col items-center w-[48px] shrink-0 bg-[var(--app-bg)] border-r border-[var(--border-color)] pb-1.5 select-none"
      style={{ ['--wails-draggable' as any]: 'no-drag' }}
    >
      {/* Branding placeholder — aligns with the pane tab bar height */}
      <div className="h-9 w-full shrink-0 border-b border-[var(--border-color)]" />

      {/* Features */}
      <div className="flex flex-col items-center gap-0.5 flex-1 pt-1.5">
        <SidebarBtn active={activePage === 'terminal'} label="Terminal" onClick={() => onNavigate('terminal')} onMouseDown={e => onStartPageDrag('terminal', e.clientX, e.clientY)}>
          <TerminalIcon />
        </SidebarBtn>
        <SidebarBtn active={activePage === 'editor'} label="Code Editor" onClick={() => onNavigate('editor')} onMouseDown={e => onStartPageDrag('editor', e.clientX, e.clientY)}>
          <EditorIcon />
        </SidebarBtn>
        <SidebarBtn active={activePage === 'versioncontrol'} label="Version Control" onClick={() => onNavigate('versioncontrol')} onMouseDown={e => onStartPageDrag('versioncontrol', e.clientX, e.clientY)}>
          <VersionControlIcon />
        </SidebarBtn>
        <SidebarBtn active={activePage === 'database'} label="Database" onClick={() => onNavigate('database')} onMouseDown={e => onStartPageDrag('database', e.clientX, e.clientY)}>
          <DatabaseIcon />
        </SidebarBtn>
        <SidebarBtn active={activePage === 'debug'} label="Debug" onClick={() => onNavigate('debug')} onMouseDown={e => onStartPageDrag('debug', e.clientX, e.clientY)}>
          <DebugIcon />
        </SidebarBtn>
        <SidebarBtn active={activePage === 'ports'} label="Ports" onClick={() => onNavigate('ports')} onMouseDown={e => onStartPageDrag('ports', e.clientX, e.clientY)}>
          <PortsIcon />
        </SidebarBtn>
        <SidebarBtn active={activePage === 'workflows'} label="Workflows" onClick={() => onNavigate('workflows')} onMouseDown={e => onStartPageDrag('workflows', e.clientX, e.clientY)}>
          <WorkflowsIcon />
        </SidebarBtn>
        <SidebarBtn active={false} label="Search (Ctrl+K)" onClick={onSearch}>
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
  )
}
