import React, { useState, useRef, useEffect, useCallback } from 'react'
import ReactDOM from 'react-dom'
import type { PageId } from '../paneModel'

export type { PageId }

// Show only the last two path segments (e.g. "C:/Users/foo/bar/baz" -> "bar/baz")
function shortPath(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.length === 0) return '~'
  return parts.length <= 2 ? parts.join('/') : parts.slice(-2).join('/')
}

interface Props {
  activePage:         PageId
  onNavigate:         (page: PageId) => void
  onSearch:           () => void
  onStartPageDrag:    (page: PageId, startX: number, startY: number) => void
  showPlugins:        boolean
  recentPaths:        string[]
  onSelectRecentPath: (path: string) => void
}

// ── Icons ─────────────────────────────────────────────────────────────────────

const TerminalIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="m7 11 2-2-2-2"/>
    <path d="M11 13h4"/>
    <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
  </svg>
)

const EditorIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 22h4a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v6"/>
    <path d="M14 2v5a1 1 0 0 0 1 1h5"/>
    <path d="M5 14a1 1 0 0 0-1 1v2a1 1 0 0 1-1 1 1 1 0 0 1 1 1v2a1 1 0 0 0 1 1"/>
    <path d="M9 22a1 1 0 0 0 1-1v-2a1 1 0 0 1 1-1 1 1 0 0 1-1-1v-2a1 1 0 0 0-1-1"/>
  </svg>
)

const DatabaseIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <ellipse cx="12" cy="5" rx="9" ry="3"/>
    <path d="M3 5V19A9 3 0 0 0 21 19V5"/>
    <path d="M3 12A9 3 0 0 0 21 12"/>
  </svg>
)

const DebugIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 19.655A6 6 0 0 1 6 14v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 3.97"/>
    <path d="M14 15.003a1 1 0 0 1 1.517-.859l4.997 2.997a1 1 0 0 1 0 1.718l-4.997 2.997a1 1 0 0 1-1.517-.86z"/>
    <path d="M14.12 3.88 16 2"/>
    <path d="M21 5a4 4 0 0 1-3.55 3.97"/>
    <path d="M3 21a4 4 0 0 1 3.81-4"/>
    <path d="M3 5a4 4 0 0 0 3.55 3.97"/>
    <path d="M6 13H2"/>
    <path d="m8 2 1.88 1.88"/>
    <path d="M9 7.13V6a3 3 0 1 1 6 0v1.13"/>
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
    <path d="m10.852 19.772-.383.924"/>
    <path d="m13.148 14.228.383-.923"/>
    <path d="M13.148 19.772a3 3 0 1 0-2.296-5.544l-.383-.923"/>
    <path d="m13.53 20.696-.382-.924a3 3 0 1 1-2.296-5.544"/>
    <path d="m14.772 15.852.923-.383"/>
    <path d="m14.772 18.148.923.383"/>
    <path d="M4.2 15.1a7 7 0 1 1 9.93-9.858A7 7 0 0 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.2"/>
    <path d="m9.228 15.852-.923-.383"/>
    <path d="m9.228 18.148-.923.383"/>
  </svg>
)

const VersionControlIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="5" cy="6" r="3"/>
    <path d="M12 6h5a2 2 0 0 1 2 2v7"/>
    <path d="m15 9-3-3 3-3"/>
    <circle cx="19" cy="18" r="3"/>
    <path d="M12 18H7a2 2 0 0 1-2-2V9"/>
    <path d="m9 15 3 3-3 3"/>
  </svg>
)

const WorkflowsIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect width="8" height="8" x="3" y="3" rx="2"/>
    <path d="M7 11v4a2 2 0 0 0 2 2h4"/>
    <rect width="8" height="8" x="13" y="13" rx="2"/>
  </svg>
)

const PluginsIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 7h3a1 1 0 0 0 1-1v-1a2 2 0 0 1 4 0v1a1 1 0 0 0 1 1h3a1 1 0 0 1 1 1v3a1 1 0 0 0 1 1h1a2 2 0 0 1 0 4h-1a1 1 0 0 0-1 1v3a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-1a2 2 0 0 0-4 0v1a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a2 2 0 0 0 0-4h-1a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z"/>
  </svg>
)

const MoreIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="1"/>
    <circle cx="19" cy="12" r="1"/>
    <circle cx="5" cy="12" r="1"/>
  </svg>
)

const NotepadIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>
  </svg>
)

const FolderIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>
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
  // Drag cursor is applied globally via the `* { cursor: grabbing !important }`
  // overlay once a drag actually starts (see App.tsx pageDrag), so this stays
  // a plain pointer until then.
  const cursorCls = 'cursor-pointer'
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
          const rect = btnRef.current.getBoundingClientRect()
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

// ── MoreMenu ──────────────────────────────────────────────────────────────────
// A non-draggable sidebar entry that, on hover or click, opens a flyout to its
// right holding overflow pages/tools plus a Recent Paths shortcut list.

const OPEN_DELAY_MS  = 120
const CLOSE_DELAY_MS = 220

interface MoreMenuProps {
  active:             boolean
  onOpenNotepad:      () => void
  recentPaths:        string[]
  onSelectRecentPath: (path: string) => void
}

function MoreMenu({ active, onOpenNotepad, recentPaths, onSelectRecentPath }: MoreMenuProps) {
  const [open, setOpen] = useState(false)
  const pinnedRef  = useRef(false)
  const btnRef     = useRef<HTMLButtonElement>(null)
  const menuRef    = useRef<HTMLDivElement>(null)
  const openTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimers = useCallback(() => {
    if (openTimer.current)  { clearTimeout(openTimer.current);  openTimer.current  = null }
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }
  }, [])

  const scheduleOpen = () => {
    clearTimers()
    openTimer.current = setTimeout(() => setOpen(true), OPEN_DELAY_MS)
  }

  const scheduleClose = () => {
    clearTimers()
    closeTimer.current = setTimeout(() => { if (!pinnedRef.current) setOpen(false) }, CLOSE_DELAY_MS)
  }

  const close = useCallback(() => {
    pinnedRef.current = false
    clearTimers()
    setOpen(false)
  }, [clearTimers])

  const handleClick = () => {
    if (open && pinnedRef.current) {
      close()
    } else {
      pinnedRef.current = true
      clearTimers()
      setOpen(true)
    }
  }

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (btnRef.current?.contains(target) || menuRef.current?.contains(target)) return
      close()
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open, close])

  useEffect(() => clearTimers, [clearTimers])

  const menuEl = open && btnRef.current
    ? ReactDOM.createPortal(
        (() => {
          const rect = btnRef.current.getBoundingClientRect()
          return (
            <div
              ref={menuRef}
              className="fixed z-[9999] w-[230px] py-1.5 rounded-md bg-[var(--info-bar-bg)] border border-sep shadow-overlay font-ui select-none"
              style={{ left: rect.right + 6, top: rect.top }}
              onMouseEnter={() => clearTimers()}
              onMouseLeave={scheduleClose}
            >
              <button
                className="flex items-center gap-2.5 w-full px-3 py-1.5 bg-transparent border-0 cursor-pointer text-[12px] text-left text-[var(--tab-color)] hover:text-[var(--tab-color-hover)] hover:bg-surface-raised transition-colors"
                onClick={() => { close(); onOpenNotepad() }}
              >
                <NotepadIcon />
                Notepad
              </button>

              <div className="mx-3 my-1.5 h-px bg-sep" />

              <div className="px-3 pb-1 text-[10px] uppercase tracking-wider opacity-50">Recent Paths</div>
              {recentPaths.length === 0 ? (
                <div className="px-3 py-1.5 text-[11.5px] opacity-40">No recent paths yet</div>
              ) : (
                recentPaths.slice(0, 5).map(p => (
                  <button
                    key={p}
                    className="flex items-center gap-2 w-full px-3 py-1.5 bg-transparent border-0 cursor-pointer text-[11.5px] text-left text-[var(--tab-color)] hover:text-[var(--tab-color-hover)] hover:bg-surface-raised transition-colors font-mono"
                    title={p}
                    onClick={() => { close(); onSelectRecentPath(p) }}
                  >
                    <span className="shrink-0 opacity-60"><FolderIcon /></span>
                    <span className="truncate">{shortPath(p)}</span>
                  </button>
                ))
              )}
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
          'relative flex items-center justify-center w-10 h-10 rounded-md border-0 cursor-pointer transition-[background,color] duration-[100ms] shrink-0',
          (active || open)
            ? 'text-[var(--tab-color-hover)] bg-surface-overlay'
            : 'text-[var(--tab-color)] bg-transparent hover:text-[var(--tab-color-hover)] hover:bg-surface-raised',
        ].join(' ')}
        onClick={handleClick}
        onMouseEnter={scheduleOpen}
        onMouseLeave={scheduleClose}
        aria-label="More"
      >
        {active && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-accent rounded-r-full" />
        )}
        <MoreIcon />
      </button>
      {menuEl}
    </>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Sidebar({ activePage, onNavigate, onSearch, onStartPageDrag, showPlugins, recentPaths, onSelectRecentPath }: Props) {
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
        <SidebarBtn active={activePage === 'ports'} label="Ports & Endpoints" onClick={() => onNavigate('ports')} onMouseDown={e => onStartPageDrag('ports', e.clientX, e.clientY)}>
          <PortsIcon />
        </SidebarBtn>
        <SidebarBtn active={activePage === 'workflows'} label="Workflows" onClick={() => onNavigate('workflows')} onMouseDown={e => onStartPageDrag('workflows', e.clientX, e.clientY)}>
          <WorkflowsIcon />
        </SidebarBtn>
        <MoreMenu
          active={activePage === 'notepad'}
          onOpenNotepad={() => onNavigate('notepad')}
          recentPaths={recentPaths}
          onSelectRecentPath={onSelectRecentPath}
        />
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
