import React, { useState, useEffect, useRef } from 'react'
import ReactDOM from 'react-dom'
import { Tab } from '../types'
import './TabBar.css'

interface Props {
  panel:    'left' | 'right'
  tabs:     Tab[]
  activeId: string
  focused:  boolean
  onSelect:             (id: string) => void
  onClose:              (id: string) => void
  onCloseOthers:        (id: string) => void
  onMoveRight:          (id: string) => void
  onMoveLeft:           (id: string) => void
  onNewTerminal:        () => void
  onAddSiblingTerminal: (parentId: string) => void
  onDrop:               (tabId: string) => void
}

// ── Icons ─────────────────────────────────────────────────────────────────────

const TerminalIcon = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
    <rect x="1.5" y="2" width="13" height="12" rx="2.5" stroke="currentColor" strokeWidth="1.3"/>
    <path d="M4.5 7.5l2 1.5-2 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M8.5 10.5h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
  </svg>
)

const CloseIcon = () => (
  <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
    <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
  </svg>
)

interface CtxMenuState {
  tabId: string
  x:     number
  y:     number
}

export default function TabBar({
  panel: _panel, tabs, activeId, focused: _focused,
  onSelect, onClose, onCloseOthers, onMoveRight, onMoveLeft,
  onNewTerminal, onAddSiblingTerminal: _onAddSibling, onDrop,
}: Props) {
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null)
  const ctxRef = useRef<HTMLDivElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const dragCounter = useRef(0)

  useEffect(() => {
    if (!ctxMenu) return
    const h = (e: MouseEvent) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) setCtxMenu(null)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [ctxMenu])

  useEffect(() => {
    if (!ctxMenu) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setCtxMenu(null) }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [ctxMenu])

  function openCtx(e: React.MouseEvent, tabId: string) {
    e.preventDefault()
    e.stopPropagation()
    const x = Math.min(e.clientX, window.innerWidth  - 180)
    const y = Math.min(e.clientY, window.innerHeight - 180)
    setCtxMenu({ tabId, x, y })
  }

  const ctxItemBase = "flex items-center w-full px-[14px] py-[7px] bg-transparent border-0 cursor-pointer text-[var(--info-bar-hover-color)] text-left transition-[background] duration-[100ms] whitespace-nowrap font-ui text-[12.5px] hover:bg-surface-raised hover:text-white"

  return (
    <div
      className={`flex items-center bg-[var(--app-bg)] h-full select-none overflow-hidden${dragOver ? ' tabbar--dragover' : ''}`}
      onDragEnter={e => { e.preventDefault(); dragCounter.current++; setDragOver(true) }}
      onDragLeave={() => { dragCounter.current--; if (dragCounter.current <= 0) { dragCounter.current = 0; setDragOver(false) } }}
      onDragOver={e => e.preventDefault()}
      onDrop={e => {
        e.preventDefault()
        dragCounter.current = 0
        setDragOver(false)
        const id = e.dataTransfer.getData('tabId')
        if (id) onDrop(id)
      }}
    >
      <div
        className="tabbar__strip flex items-stretch h-full overflow-x-auto overflow-y-hidden flex-1 min-w-0"
        style={{ ['--wails-draggable' as any]: 'no-drag' }}
      >
        {tabs.map(tab => {
          const isActive = tab.id === activeId
          return (
            <div
              key={tab.id}
              className={[
                'tabbar__tab',
                'flex items-center pb-[2px] gap-[6px] px-[12px] cursor-pointer whitespace-nowrap shrink-0 select-none',
                'text-[12px] font-ui tracking-[0.01em] relative group/tab',
                'transition-[color,background] duration-[100ms]',
                isActive
                  ? 'tabbar__tab--active text-[var(--tab-color-hover)] bg-[var(--surface-raised,rgba(255,255,255,0.05))]'
                  : 'text-[var(--tab-color)] hover:text-[var(--tab-color-hover)] hover:bg-[rgba(255,255,255,0.03)] active:opacity-70',
              ].join(' ')}
              draggable
              onDragStart={e => { e.dataTransfer.setData('tabId', tab.id); e.dataTransfer.effectAllowed = 'move' }}
              onClick={() => onSelect(tab.id)}
              onContextMenu={e => openCtx(e, tab.id)}
              title={tab.title}
            >
              {/* Active indicator — bottom border */}
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent rounded-t-full" />
              )}

              <TerminalIcon />

              <span className="max-w-[120px] overflow-hidden text-ellipsis">{tab.title}</span>

              <button
                className={[
                  'flex items-center justify-center w-[14px] h-[14px] rounded-xs bg-transparent border-0 cursor-pointer p-0 shrink-0 ml-px',
                  'transition-[opacity,background] duration-[100ms]',
                  'opacity-0 group-hover/tab:opacity-[0.45] hover:opacity-100! hover:bg-surface-overlay',
                  isActive ? 'opacity-[0.35]' : '',
                ].join(' ')}
                onClick={e => { e.stopPropagation(); onClose(tab.id) }}
                aria-label="Close"
              >
                <CloseIcon />
              </button>
            </div>
          )
        })}

        {/* New terminal button */}
        <button
          className="flex items-center justify-center w-[32px] h-full shrink-0 bg-transparent border-0 cursor-pointer text-[var(--tab-color)] opacity-40 transition-[opacity,background] duration-[100ms] hover:opacity-100 hover:bg-surface-raised hover:text-[var(--tab-color-hover)] pb-[2px]"
          onClick={onNewTerminal}
          title="New terminal (Ctrl+T)"
        >
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
            <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      {ctxMenu && ReactDOM.createPortal(
        <div
          ref={ctxRef}
          className="fixed z-[9999] bg-[var(--info-bar-bg)] border border-sep-strong rounded-md py-1 min-w-[170px] shadow-overlay font-ui text-[12.5px] backdrop-blur-[16px]"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          <button className={ctxItemBase} onClick={() => { onMoveLeft(ctxMenu.tabId); setCtxMenu(null) }}>Move Left</button>
          <button className={ctxItemBase} onClick={() => { onMoveRight(ctxMenu.tabId); setCtxMenu(null) }}>Move Right</button>
          <div className="h-px bg-sep my-[3px]" />
          <button className={ctxItemBase} onClick={() => { onClose(ctxMenu.tabId); setCtxMenu(null) }}>Close Tab</button>
          <button className={ctxItemBase} onClick={() => { onCloseOthers(ctxMenu.tabId); setCtxMenu(null) }}>Close Others</button>
        </div>,
        document.body
      )}
    </div>
  )
}
