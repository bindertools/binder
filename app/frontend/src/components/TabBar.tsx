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

const GROUP_COLORS = [
  '#4fc3f7',
  '#81c995',
  '#ffb74d',
  '#f48fb1',
  '#ce93d8',
  '#80cbc4',
  '#bcaaa4',
]

interface Group {
  terminals: Tab[]
  color:     string
  files:     Tab[]
}

function rgba(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${a})`
}

function buildGroups(tabs: Tab[]): Group[] {
  const groups: Group[]     = []
  const termToGroup         = new Map<string, Group>()
  let colorIdx = 0

  for (const tab of tabs) {
    if (tab.type === 'terminal') {
      const parent = tab.parentId ? termToGroup.get(tab.parentId) : null
      if (parent) {
        parent.terminals.push(tab)
        termToGroup.set(tab.id, parent)
      } else {
        const color = GROUP_COLORS[colorIdx % GROUP_COLORS.length]
        colorIdx++
        const g: Group = { terminals: [tab], color, files: [] }
        groups.push(g)
        termToGroup.set(tab.id, g)
      }
    } else {
      const group = tab.parentId ? termToGroup.get(tab.parentId) : null
      if (group) {
        group.files.push(tab)
      } else if (groups.length > 0) {
        groups[groups.length - 1].files.push(tab)
      } else {
        groups.push({ terminals: [], color: GROUP_COLORS[0], files: [tab] })
      }
    }
  }
  return groups
}

const TerminalIcon = ({ color }: { color: string }) => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ color, flexShrink: 0 }}>
    <path d="M2.5 5.5l3.5 2.5-3.5 2.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M8 10.5h5.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
  </svg>
)

const FileIcon = ({ color }: { color: string }) => (
  <svg width="11" height="12" viewBox="0 0 14 16" fill="none" style={{ color, flexShrink: 0 }}>
    <path d="M2 1.5h7.5L12 4v10H2V1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
    <path d="M9.5 1.5V4H12" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
  </svg>
)

const DatabaseIcon = ({ color }: { color: string }) => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ color, flexShrink: 0 }}>
    <ellipse cx="8" cy="4" rx="5" ry="1.8" stroke="currentColor" strokeWidth="1.3"/>
    <path d="M3 4v8c0 1 2.24 1.8 5 1.8s5-.8 5-1.8V4" stroke="currentColor" strokeWidth="1.3"/>
    <path d="M3 8c0 1 2.24 1.8 5 1.8s5-.8 5-1.8" stroke="currentColor" strokeWidth="1.3"/>
  </svg>
)

const PreviewIcon = ({ color }: { color: string }) => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ color, flexShrink: 0 }}>
    <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.3"/>
    <path d="M2.5 8h11" stroke="currentColor" strokeWidth="1.3"/>
    <path d="M8 2.5c-1.5 1.5-2 3.3-2 5.5s.5 4 2 5.5M8 2.5c1.5 1.5 2 3.3 2 5.5s-.5 4-2 5.5" stroke="currentColor" strokeWidth="1.3"/>
  </svg>
)

const PaletteIcon = ({ color }: { color: string }) => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ color, flexShrink: 0 }}>
    <path d="M8 2C4.69 2 2 4.69 2 8s2.69 6 6 6c.55 0 1-.45 1-1 0-.26-.1-.49-.26-.67-.14-.18-.24-.4-.24-.63 0-.55.45-1 1-1H11c2.21 0 4-1.79 4-4 0-3.31-3.13-5-7-5z"
      stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
    <circle cx="5.5" cy="7.5" r="0.9" fill="currentColor"/>
    <circle cx="8" cy="5.5" r="0.9" fill="currentColor"/>
    <circle cx="10.5" cy="7.5" r="0.9" fill="currentColor"/>
  </svg>
)

const ProblemsIcon = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ color: '#dda055', flexShrink: 0 }}>
    <path d="M8 2.5L14.5 13H1.5L8 2.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
    <path d="M8 6.5v3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <circle cx="8" cy="11.5" r="0.65" fill="currentColor"/>
  </svg>
)

const CloseIcon = () => (
  <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
    <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
  </svg>
)

function tabIcon(tab: Tab, color: string): React.ReactNode {
  switch (tab.type) {
    case 'editor':   return <FileIcon color={color} />
    case 'database': return <DatabaseIcon color={color} />
    case 'preview':  return <PreviewIcon color={color} />
    case 'problems': return <ProblemsIcon />
    case 'config':   return <PaletteIcon color={color} />
    default:         return <FileIcon color={color} />
  }
}

interface CtxMenuState {
  tabId: string
  tab:   Tab
  x:     number
  y:     number
}

export default function TabBar({
  panel, tabs, activeId, focused,
  onSelect, onClose, onCloseOthers, onMoveRight, onMoveLeft,
  onNewTerminal, onAddSiblingTerminal, onDrop,
}: Props) {
  const groups = buildGroups(tabs)

  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null)
  const ctxRef   = useRef<HTMLDivElement>(null)
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

  function openCtx(e: React.MouseEvent, tab: Tab) {
    e.preventDefault()
    e.stopPropagation()
    const x = Math.min(e.clientX, window.innerWidth  - 180)
    const y = Math.min(e.clientY, window.innerHeight - 200)
    setCtxMenu({ tabId: tab.id, tab, x, y })
  }

  return (
    <div
      className={`tabbar${focused ? ' tabbar--focused' : ''}${dragOver ? ' tabbar--dragover' : ''}`}
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
      <div className="tabbar__strip" style={{ ['--wails-draggable' as any]: 'no-drag' }}>

        {groups.map((group, gi) => {
          const firstTermId = group.terminals[0]?.id
          return (
            <React.Fragment key={firstTermId ?? `g${gi}`}>

              {gi > 0 && <div className="tabbar__sep" />}

              <div className="tabbar__group">

                {group.terminals.map(term => {
                  const isActive = term.id === activeId
                  return (
                    <div
                      key={term.id}
                      className={`tabbar__tab${isActive ? ' is-active' : ''}`}
                      style={isActive ? { '--tab-accent': group.color, background: rgba(group.color, 0.1) } as React.CSSProperties : undefined}
                      draggable
                      onDragStart={e => { e.dataTransfer.setData('tabId', term.id); e.dataTransfer.effectAllowed = 'move' }}
                      onClick={() => onSelect(term.id)}
                      onContextMenu={e => openCtx(e, term)}
                      title={term.title}
                    >
                      <TerminalIcon color={isActive ? group.color : rgba(group.color, 0.45)} />
                      <span className="tabbar__tab-title">{term.title}</span>
                      <button
                        className="tabbar__close"
                        onClick={e => { e.stopPropagation(); onClose(term.id) }}
                        aria-label="Close"
                      >
                        <CloseIcon />
                      </button>
                    </div>
                  )
                })}

                {firstTermId && (
                  <button
                    className="tabbar__sib-add"
                    style={{ color: group.color }}
                    onClick={() => onAddSiblingTerminal(firstTermId)}
                    title="New terminal in this group"
                  >
                    <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                      <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                    </svg>
                  </button>
                )}

                {group.files.map(tab => {
                  const isActive  = tab.id === activeId
                  const iconColor = isActive ? group.color : rgba(group.color, 0.5)
                  return (
                    <div
                      key={tab.id}
                      className={`tabbar__tab tabbar__tab--file${isActive ? ' is-active' : ''}`}
                      style={isActive ? { '--tab-accent': group.color, background: rgba(group.color, 0.08) } as React.CSSProperties : undefined}
                      draggable
                      onDragStart={e => { e.dataTransfer.setData('tabId', tab.id); e.dataTransfer.effectAllowed = 'move' }}
                      onClick={() => onSelect(tab.id)}
                      onContextMenu={e => openCtx(e, tab)}
                      title={tab.filePath ?? tab.title}
                    >
                      {tabIcon(tab, iconColor)}
                      <span className="tabbar__tab-title">{tab.title}</span>
                      <button
                        className="tabbar__close"
                        onClick={e => { e.stopPropagation(); onClose(tab.id) }}
                        aria-label="Close"
                      >
                        <CloseIcon />
                      </button>
                    </div>
                  )
                })}

              </div>

            </React.Fragment>
          )
        })}

        <button className="tabbar__new-term" onClick={onNewTerminal} title="New terminal">
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
            <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>

      </div>

      {ctxMenu && ReactDOM.createPortal(
        <div
          ref={ctxRef}
          className="tab-ctx-menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          <button className="tab-ctx-item" onClick={() => { onMoveLeft(ctxMenu.tabId); setCtxMenu(null) }}>
            Move Left
          </button>
          <button className="tab-ctx-item" onClick={() => { onMoveRight(ctxMenu.tabId); setCtxMenu(null) }}>
            Move Right
          </button>
          <div className="tab-ctx-sep" />
          <button className="tab-ctx-item" onClick={() => { onClose(ctxMenu.tabId); setCtxMenu(null) }}>
            Close Tab
          </button>
          <button className="tab-ctx-item" onClick={() => { onCloseOthers(ctxMenu.tabId); setCtxMenu(null) }}>
            Close Others
          </button>
        </div>,
        document.body
      )}
    </div>
  )
}
