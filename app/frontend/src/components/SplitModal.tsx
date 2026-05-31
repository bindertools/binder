import React, { useState, useCallback, useRef } from 'react'
import ReactDOM from 'react-dom'
import { Tab } from '../types'

interface Props {
  open:          boolean
  tabs:          Tab[]
  tabPanels:     Record<string, 'left' | 'right'>
  splitEnabled:  boolean
  terminalCwds:  Record<string, string>
  onAssign:      (tabId: string, panel: 'left' | 'right') => void
  onSetSplit:    (enabled: boolean) => void
  onDismiss:     () => void
}

// ── small icons ───────────────────────────────────────────────────────────────
const IcoTerm = () => (
  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="1" width="14" height="14" rx="2"/>
    <path d="M4 5l3 3-3 3M9 11h4"/>
  </svg>
)
const IcoFile = () => (
  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 1h6l4 4v10a1 1 0 01-1 1H3a1 1 0 01-1-1V2a1 1 0 011-1z"/>
    <path d="M10 1v4h4"/>
  </svg>
)
const IcoGeneric = () => (
  <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
    <rect x="1.5" y="1.5" width="5" height="5" rx="1"/>
    <rect x="9.5" y="1.5" width="5" height="5" rx="1"/>
    <rect x="1.5" y="9.5" width="5" height="5" rx="1"/>
    <rect x="9.5" y="9.5" width="5" height="5" rx="1"/>
  </svg>
)

const TabIcon = ({ type }: { type: string }) =>
  type === 'terminal' ? <IcoTerm /> : type === 'editor' ? <IcoFile /> : <IcoGeneric />

const tabLabel = (t: Tab, cwds: Record<string, string>) => {
  if (t.type === 'terminal') {
    const cwd = (cwds[t.id] ?? '').replace(/\\/g, '/').split('/').filter(Boolean)
    return cwd.length ? cwd.slice(-2).join('/') : 'terminal'
  }
  return t.title
}

// ── draggable tab card ────────────────────────────────────────────────────────
const TabCard = ({
  tab, cwds, panel, onDragStart,
}: {
  tab: Tab
  cwds: Record<string, string>
  panel: 'left' | 'right'
  onDragStart: (e: React.DragEvent, id: string) => void
}) => (
  <div
    draggable
    onDragStart={e => onDragStart(e, tab.id)}
    className="flex items-center gap-1.5 px-2 py-[5px] rounded-md border border-[var(--border-color)] bg-[var(--app-bg)] cursor-grab active:cursor-grabbing select-none text-[var(--tab-color)] hover:text-[var(--tab-color-hover)] hover:border-sep-strong transition-[background,border-color,color] duration-[80ms] text-[11.5px] font-ui"
    title={`Drag to move — currently in ${panel} panel`}
  >
    <span className="shrink-0 opacity-70"><TabIcon type={tab.type} /></span>
    <span className="truncate max-w-[120px]">{tabLabel(tab, cwds)}</span>
    <span className="shrink-0 ml-auto opacity-30">
      <svg width="9" height="12" viewBox="0 0 9 14" fill="currentColor">
        <circle cx="2.5" cy="2.5" r="1.3"/>
        <circle cx="6.5" cy="2.5" r="1.3"/>
        <circle cx="2.5" cy="7" r="1.3"/>
        <circle cx="6.5" cy="7" r="1.3"/>
        <circle cx="2.5" cy="11.5" r="1.3"/>
        <circle cx="6.5" cy="11.5" r="1.3"/>
      </svg>
    </span>
  </div>
)

// ── panel drop zone ───────────────────────────────────────────────────────────
const PanelZone = ({
  label, panelId, tabs, cwds, dragOver,
  onDragOver, onDragLeave, onDrop,
}: {
  label: string
  panelId: 'left' | 'right'
  tabs: Tab[]
  cwds: Record<string, string>
  dragOver: boolean
  onDragOver: (e: React.DragEvent, panel: 'left' | 'right') => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent, panel: 'left' | 'right') => void
}) => (
  <div
    className={`flex-1 flex flex-col gap-1.5 min-h-[160px] rounded-lg border-2 p-3 transition-[border-color,background] duration-[100ms] ${
      dragOver
        ? 'border-accent bg-[rgba(10,132,255,0.06)]'
        : 'border-dashed border-[var(--border-color)] bg-[var(--app-bg)]'
    }`}
    onDragOver={e => onDragOver(e, panelId)}
    onDragLeave={onDragLeave}
    onDrop={e => onDrop(e, panelId)}
  >
    <div className="text-[10px] font-semibold tracking-[0.1em] uppercase text-[var(--tab-color)] opacity-50 select-none mb-1">
      {label}
    </div>
    {tabs.length === 0 ? (
      <div className="flex-1 flex items-center justify-center text-[11px] text-[var(--tab-color)] opacity-30 select-none">
        Drop tabs here
      </div>
    ) : (
      <div className="flex flex-col gap-1">
        {tabs.map(t => (
          <TabCard key={t.id} tab={t} cwds={cwds} panel={panelId} onDragStart={(e, id) => {
            e.dataTransfer.setData('text/plain', id)
          }} />
        ))}
      </div>
    )}
  </div>
)

// ── main modal ────────────────────────────────────────────────────────────────
export default function SplitModal({
  open, tabs, tabPanels, splitEnabled, terminalCwds,
  onAssign, onSetSplit, onDismiss,
}: Props) {
  // Local panel assignment — starts from current tabPanels, updates on drop
  const [local, setLocal] = useState<Record<string, 'left' | 'right'>>(() => ({ ...tabPanels }))
  const [dragOverPanel, setDragOverPanel] = useState<'left' | 'right' | null>(null)
  const [splitOn, setSplitOn] = useState(splitEnabled)
  const draggingId = useRef<string | null>(null)

  // Re-sync when modal opens
  React.useEffect(() => {
    if (open) {
      setLocal({ ...tabPanels })
      setSplitOn(splitEnabled)
    }
  }, [open, tabPanels, splitEnabled])

  const leftTabs  = tabs.filter(t => (local[t.id] ?? 'left') === 'left')
  const rightTabs = tabs.filter(t => local[t.id] === 'right')

  const _handleDragStart = (e: React.DragEvent, id: string) => {
    draggingId.current = id
    e.dataTransfer.setData('text/plain', id)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = useCallback((e: React.DragEvent, panel: 'left' | 'right') => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverPanel(panel)
  }, [])

  const handleDragLeave = useCallback(() => {
    setDragOverPanel(null)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent, panel: 'left' | 'right') => {
    e.preventDefault()
    const id = e.dataTransfer.getData('text/plain') || draggingId.current
    if (id) setLocal(prev => ({ ...prev, [id]: panel }))
    setDragOverPanel(null)
    draggingId.current = null
  }, [])

  const handleApply = () => {
    // Push all changes to parent
    for (const [tabId, panel] of Object.entries(local)) {
      const current = tabPanels[tabId] ?? 'left'
      if (panel !== current) onAssign(tabId, panel)
    }
    onSetSplit(splitOn)
    onDismiss()
  }

  if (!open) return null

  return ReactDOM.createPortal(
    <>
      {/* backdrop */}
      <div className="fixed inset-0 z-[10000] bg-black/40 backdrop-blur-[2px]" onClick={onDismiss} />

      {/* dialog */}
      <div className="fixed z-[10001] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[520px] max-w-[96vw] bg-[var(--info-bar-bg)] border border-[var(--border-color)] rounded-xl shadow-[var(--shadow-overlay)] flex flex-col overflow-hidden">

        {/* header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)]">
          <span className="text-[13px] font-semibold text-[var(--tab-color-hover)]">Split View Layout</span>
          <button
            className="flex items-center justify-center w-6 h-6 rounded text-[var(--tab-color)] hover:bg-surface-raised hover:text-[var(--tab-color-hover)] transition-colors"
            onClick={onDismiss}
          >
            <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        </div>

        {/* panels */}
        <div className="flex gap-3 p-4">
          <PanelZone
            label="Left panel"
            panelId="left"
            tabs={leftTabs}
            cwds={terminalCwds}
            dragOver={dragOverPanel === 'left'}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          />
          <PanelZone
            label="Right panel"
            panelId="right"
            tabs={rightTabs}
            cwds={terminalCwds}
            dragOver={dragOverPanel === 'right'}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          />
        </div>

        {/* hint */}
        <p className="px-4 pb-1 text-[10.5px] text-[var(--tab-color)] opacity-50 select-none">
          Drag tabs between panels to rearrange your split layout.
        </p>

        {/* footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border-color)]">
          {/* split toggle */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <button
              role="switch"
              aria-checked={splitOn}
              onClick={() => setSplitOn(v => !v)}
              className={`relative inline-flex w-8 h-[18px] rounded-full transition-colors duration-[150ms] border-0 p-0 cursor-pointer ${splitOn ? 'bg-accent' : 'bg-sep-strong'}`}
            >
              <span className={`absolute top-[2px] left-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform duration-[150ms] ${splitOn ? 'translate-x-[14px]' : 'translate-x-0'}`} />
            </button>
            <span className="text-[12px] text-[var(--tab-color)]">Enable split view</span>
          </label>

          <button
            className="px-4 h-7 rounded-md bg-accent text-white text-[12px] font-medium cursor-pointer border-0 hover:bg-accent-hover transition-colors duration-[100ms]"
            onClick={handleApply}
          >
            Apply
          </button>
        </div>
      </div>
    </>,
    document.body
  )
}
