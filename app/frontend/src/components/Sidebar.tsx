import React from 'react'

export type PageId = 'terminal' | 'editor' | 'database' | 'problems' | 'settings' | 'plugins'

interface Props {
  activePage: PageId
  onNavigate: (page: PageId) => void
  onSearch:   () => void
  showPlugins: boolean
}

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

const ProblemsIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
    <line x1="12" y1="9" x2="12" y2="13"/>
    <line x1="12" y1="17" x2="12.01" y2="17"/>
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

interface BtnProps {
  active:  boolean
  label:   string
  onClick: () => void
  children: React.ReactNode
}

function SidebarBtn({ active, label, onClick, children }: BtnProps) {
  return (
    <button
      className={[
        'relative flex items-center justify-center w-10 h-10 rounded-md border-0 cursor-pointer transition-[background,color] duration-[100ms] shrink-0',
        active
          ? 'text-[var(--tab-color-hover)] bg-surface-overlay'
          : 'text-[var(--tab-color)] bg-transparent hover:text-[var(--tab-color-hover)] hover:bg-surface-raised',
      ].join(' ')}
      onClick={onClick}
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

export default function Sidebar({ activePage, onNavigate, onSearch, showPlugins }: Props) {
  return (
    <div
      className="flex flex-col items-center w-[48px] shrink-0 bg-[var(--app-bg)] border-r border-[var(--border-color)] py-1.5 select-none"
      style={{ ['--wails-draggable' as any]: 'no-drag' }}
    >
      {/* Features */}
      <div className="flex flex-col items-center gap-0.5 flex-1">
        <SidebarBtn active={activePage === 'terminal'} label="Terminal" onClick={() => onNavigate('terminal')}>
          <TerminalIcon />
        </SidebarBtn>
        <SidebarBtn active={activePage === 'editor'} label="Code Editor" onClick={() => onNavigate('editor')}>
          <EditorIcon />
        </SidebarBtn>
        <SidebarBtn active={activePage === 'database'} label="Database" onClick={() => onNavigate('database')}>
          <DatabaseIcon />
        </SidebarBtn>
        <SidebarBtn active={activePage === 'problems'} label="Problems" onClick={() => onNavigate('problems')}>
          <ProblemsIcon />
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
  )
}
