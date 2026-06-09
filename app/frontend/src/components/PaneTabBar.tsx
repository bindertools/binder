import React, { useState, useRef, useEffect } from 'react'
import ReactDOM from 'react-dom'
import { Tab } from '../types'

// ── Tab type icons ─────────────────────────────────────────────────────────────

const IcoTerminal = () => (
  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <rect x="1.5" y="2" width="13" height="12" rx="2.5"/>
    <path d="M4.5 7.5l2 1.5-2 1.5M8.5 10.5h3"/>
  </svg>
)
const IcoEditor = () => (
  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <path d="M3 1h6l4 4v10H3V1z"/>
    <path d="M9 1v4h4M5 8h6M5 11h4"/>
  </svg>
)
const IcoDatabase = () => (
  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <ellipse cx="8" cy="4" rx="6" ry="2.5"/>
    <path d="M2 4v3c0 1.38 2.69 2.5 6 2.5s6-1.12 6-2.5V4"/>
    <path d="M2 7v3c0 1.38 2.69 2.5 6 2.5s6-1.12 6-2.5V7"/>
  </svg>
)
const IcoPreview = () => (
  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <rect x="1" y="2" width="14" height="12" rx="2"/>
    <path d="M1 6h14"/>
    <circle cx="4" cy="4" r=".8" fill="currentColor" stroke="none"/>
    <circle cx="7" cy="4" r=".8" fill="currentColor" stroke="none"/>
  </svg>
)
const IcoDebug = () => (
  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <rect x="5" y="3" width="6" height="9" rx="3"/>
    <path d="M5 6H2M5 9H2M11 6h3M11 9h3"/>
  </svg>
)
const IcoGeneric = () => (
  <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0 }}>
    <rect x="1.5" y="1.5" width="5" height="5" rx="1"/>
    <rect x="9.5" y="1.5" width="5" height="5" rx="1"/>
    <rect x="1.5" y="9.5" width="5" height="5" rx="1"/>
    <rect x="9.5" y="9.5" width="5" height="5" rx="1"/>
  </svg>
)

const CloseIcon = () => (
  <svg width="7" height="7" viewBox="0 0 10 10" fill="none">
    <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
  </svg>
)

function TabIcon({ type }: { type: string }) {
  if (type === 'terminal') return <IcoTerminal />
  if (type === 'editor')   return <IcoEditor />
  if (type === 'database') return <IcoDatabase />
  if (type === 'preview')  return <IcoPreview />
  if (type === 'debug')    return <IcoDebug />
  return <IcoGeneric />
}

// ── Colors ────────────────────────────────────────────────────────────────────

const TAB_COLORS = [
  { name: 'Red',    value: '#FF453A' },
  { name: 'Orange', value: '#FF9F0A' },
  { name: 'Yellow', value: '#FFD60A' },
  { name: 'Green',  value: '#30D158' },
  { name: 'Blue',   value: '#0A84FF' },
  { name: 'Purple', value: '#BF5AF2' },
  { name: 'Pink',   value: '#FF375F' },
  { name: 'Gray',   value: '#98989D' },
]

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  paneId:         string
  tabs:           Tab[]
  activeId:       string
  canClosePane:   boolean
  windowControls?: React.ReactNode
  onSelect:       (tabId: string) => void
  onClose:        (tabId: string) => void
  onNewTerminal:  () => void
  onSplit:        (dir: 'h' | 'v') => void
  onClosePane:    () => void
  onRename:       (id: string, title: string) => void
  onSetColor:     (id: string, color: string | null) => void
  onDuplicate:    (id: string) => void
  onDrop:         (tabId: string) => void
}

interface CtxState { tabId: string; x: number; y: number }

export default function PaneTabBar({
  paneId: _paneId, tabs, activeId, canClosePane, windowControls,
  onSelect, onClose, onNewTerminal, onSplit, onClosePane,
  onRename, onSetColor, onDuplicate, onDrop,
}: Props) {
  const [ctx, setCtx]             = useState<CtxState | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [dragOver, setDragOver]   = useState(false)
  const ctxRef    = useRef<HTMLDivElement>(null)
  const renameRef = useRef<HTMLInputElement>(null)
  const dragCtr   = useRef(0)

  useEffect(() => {
    if (renamingId) { renameRef.current?.focus(); renameRef.current?.select() }
  }, [renamingId])

  useEffect(() => {
    if (!ctx) return
    const onDown = (e: MouseEvent) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) setCtx(null)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCtx(null) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [ctx])

  function openCtx(e: React.MouseEvent, tabId: string) {
    e.preventDefault(); e.stopPropagation()
    setCtx({ tabId, x: Math.min(e.clientX, window.innerWidth - 200), y: Math.min(e.clientY, window.innerHeight - 240) })
  }

  function commitRename() {
    if (renamingId) onRename(renamingId, renameValue)
    setRenamingId(null)
  }

  const ctxItemCls = "flex items-center w-full px-[13px] py-[6px] bg-transparent border-0 cursor-pointer text-[var(--info-bar-hover-color)] text-left transition-[background] duration-[100ms] whitespace-nowrap font-ui text-[12px] hover:bg-surface-raised"

  return (
    <div
      className={`flex items-stretch h-[36px] bg-[var(--app-bg)] border-b border-[var(--border-color)] select-none overflow-hidden shrink-0${dragOver ? ' bg-[rgba(10,132,255,0.05)]' : ''}`}
      style={{ ['--wails-draggable' as any]: 'drag' }}
      onDragEnter={e => { e.preventDefault(); dragCtr.current++; setDragOver(true) }}
      onDragLeave={() => { dragCtr.current--; if (dragCtr.current <= 0) { dragCtr.current = 0; setDragOver(false) } }}
      onDragOver={e => e.preventDefault()}
      onDrop={e => {
        e.preventDefault(); dragCtr.current = 0; setDragOver(false)
        const id = e.dataTransfer.getData('pane-tab-id')
        if (id) onDrop(id)
      }}
    >
      {/* Tab strip */}
      <div className="flex items-stretch overflow-x-auto overflow-y-hidden flex-1 min-w-0 pane-tabbar__strip"
        style={{ ['--wails-draggable' as any]: 'no-drag' }}>
        {tabs.map(tab => {
          const isActive = tab.id === activeId
          return (
            <div
              key={tab.id}
              className={[
                'flex items-center gap-[5px] px-[10px] cursor-pointer whitespace-nowrap shrink-0 select-none relative group/tab',
                'text-[11.5px] font-ui transition-[color,background] duration-[100ms]',
                isActive
                  ? 'text-[var(--tab-color-hover)] bg-[var(--surface-raised,rgba(255,255,255,0.05))]'
                  : 'text-[var(--tab-color)] hover:text-[var(--tab-color-hover)] hover:bg-[rgba(255,255,255,0.03)]',
              ].join(' ')}
              draggable={renamingId !== tab.id}
              onDragStart={e => { e.dataTransfer.setData('pane-tab-id', tab.id); e.dataTransfer.effectAllowed = 'move' }}
              onClick={() => onSelect(tab.id)}
              onContextMenu={e => openCtx(e, tab.id)}
              onDoubleClick={() => { setRenamingId(tab.id); setRenameValue(tab.title) }}
            >
              {(isActive || tab.color) && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] rounded-t-full" style={{ background: tab.color ?? 'var(--accent)' }} />
              )}
              <TabIcon type={tab.type} />
              {renamingId === tab.id ? (
                <input
                  ref={renameRef}
                  className="max-w-[110px] w-[110px] bg-transparent border-0 border-b border-[var(--accent)] outline-none text-inherit font-ui text-[11.5px] px-0"
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  onClick={e => e.stopPropagation()}
                  onBlur={commitRename}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); commitRename() }
                    else if (e.key === 'Escape') { e.preventDefault(); setRenamingId(null) }
                    e.stopPropagation()
                  }}
                  spellCheck={false}
                />
              ) : (
                <span className="max-w-[110px] overflow-hidden text-ellipsis">{tab.title}</span>
              )}
              <button
                className="flex items-center justify-center w-[13px] h-[13px] rounded-xs bg-transparent border-0 cursor-pointer p-0 shrink-0 ml-px opacity-0 group-hover/tab:opacity-40 hover:!opacity-100 hover:bg-surface-overlay transition-opacity duration-[100ms]"
                onClick={e => { e.stopPropagation(); onClose(tab.id) }}
                aria-label="Close tab"
              >
                <CloseIcon />
              </button>
            </div>
          )
        })}

        {/* New terminal */}
        <button
          className="flex items-center justify-center w-[28px] shrink-0 bg-transparent border-0 cursor-pointer text-[var(--tab-color)] opacity-35 transition-[opacity,background] duration-[100ms] hover:opacity-100 hover:bg-surface-raised hover:text-[var(--tab-color-hover)]"
          onClick={onNewTerminal}
          title="New terminal"
        >
          <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
            <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      {/* Pane controls */}
      <div className="flex items-center px-1 gap-0.5 shrink-0 border-l border-[var(--border-color)]"
        style={{ ['--wails-draggable' as any]: 'no-drag' }}>
        <button
          className="flex items-center justify-center w-[22px] h-[22px] rounded bg-transparent border-0 cursor-pointer text-[var(--tab-color)] opacity-40 hover:opacity-100 hover:bg-surface-raised hover:text-[var(--tab-color-hover)] transition-[opacity,background,color] duration-[100ms]"
          onClick={() => onSplit('h')}
          title="Split pane horizontally"
        >
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <rect x="1" y="1" width="12" height="12" rx="1.5"/>
            <line x1="7" y1="1" x2="7" y2="13"/>
          </svg>
        </button>
        <button
          className="flex items-center justify-center w-[22px] h-[22px] rounded bg-transparent border-0 cursor-pointer text-[var(--tab-color)] opacity-40 hover:opacity-100 hover:bg-surface-raised hover:text-[var(--tab-color-hover)] transition-[opacity,background,color] duration-[100ms]"
          onClick={() => onSplit('v')}
          title="Split pane vertically"
        >
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <rect x="1" y="1" width="12" height="12" rx="1.5"/>
            <line x1="1" y1="7" x2="13" y2="7"/>
          </svg>
        </button>
        {canClosePane && (
          <button
            className="flex items-center justify-center w-[22px] h-[22px] rounded bg-transparent border-0 cursor-pointer text-[var(--tab-color)] opacity-40 hover:opacity-100 hover:bg-surface-raised hover:text-[var(--tab-color-hover)] transition-[opacity,background,color] duration-[100ms]"
            onClick={onClosePane}
            title="Close pane"
          >
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
              <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        )}
      </div>

      {windowControls && (
        <div className="flex items-center shrink-0"
          style={{ ['--wails-draggable' as any]: 'no-drag' }}>
          {windowControls}
        </div>
      )}

      {/* Context menu */}
      {ctx && ReactDOM.createPortal(
        <div
          ref={ctxRef}
          className="fixed z-[9999] bg-[var(--info-bar-bg)] border border-sep-strong rounded-md py-1 min-w-[168px] shadow-overlay font-ui backdrop-blur-[16px]"
          style={{ left: ctx.x, top: ctx.y }}
        >
          <button className={ctxItemCls} onClick={() => { setRenamingId(ctx.tabId); setRenameValue(tabs.find(t => t.id === ctx.tabId)?.title ?? ''); setCtx(null) }}>Rename Tab</button>
          <div className="px-[13px] pt-[6px] pb-[7px]">
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--info-bar-color)] opacity-50 mb-[6px]">Tab Color</div>
            <div className="flex items-center gap-[6px]">
              {TAB_COLORS.map(c => {
                const selected = tabs.find(t => t.id === ctx.tabId)?.color === c.value
                return (
                  <button
                    key={c.value}
                    className="w-[14px] h-[14px] rounded-full border-0 cursor-pointer p-0 shrink-0 transition-transform hover:scale-[1.15]"
                    style={{ background: c.value, boxShadow: selected ? `0 0 0 2px var(--info-bar-bg), 0 0 0 3.5px ${c.value}` : 'none' }}
                    title={c.name}
                    onClick={() => { onSetColor(ctx.tabId, c.value); setCtx(null) }}
                  />
                )
              })}
              <button
                className="w-[14px] h-[14px] rounded-full bg-transparent border border-[var(--sep-strong)] cursor-pointer p-0 shrink-0 flex items-center justify-center text-[var(--info-bar-color)] hover:text-[var(--info-bar-hover-color)] transition-colors"
                title="Clear color"
                onClick={() => { onSetColor(ctx.tabId, null); setCtx(null) }}
              >
                <svg width="6" height="6" viewBox="0 0 10 10"><path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              </button>
            </div>
          </div>
          <div className="h-px bg-sep my-1" />
          <button className={ctxItemCls} onClick={() => { onDuplicate(ctx.tabId); setCtx(null) }}>Duplicate Tab</button>
          <div className="h-px bg-sep my-1" />
          <button className={ctxItemCls} onClick={() => { onClose(ctx.tabId); setCtx(null) }}>Close Tab</button>
        </div>,
        document.body,
      )}
    </div>
  )
}
