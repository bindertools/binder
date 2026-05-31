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

// ── Terminal icon (window frame + >_ prompt) ──────────────────────────────────
const TerminalIcon = ({ color }: { color: string }) => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ color, flexShrink: 0 }}>
    <rect x="1.5" y="2" width="13" height="12" rx="2.5" stroke="currentColor" strokeWidth="1.25"/>
    <path d="M4.5 7.5l2 1.5-2 1.5" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M8.5 10.5h3" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round"/>
  </svg>
)

// ── Generic file fallback ─────────────────────────────────────────────────────
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

// ── Language icon system ──────────────────────────────────────────────────────

// Span-based badge — CSS text rendering is far crisper than SVG <text> at small sizes
const LangBadge = ({ letters, bg, active }: { letters: string; bg: string; active: boolean }) => (
  <span
    className={`inline-flex items-center justify-center shrink-0 h-[15px] rounded-[3px] text-white font-[800] leading-none select-none px-[3.5px]${active ? '' : ' opacity-50'}`}
    style={{
      background: bg,
      minWidth: letters.length > 2 ? 24 : 19,
      fontSize: letters.length > 2 ? 8 : 9,
      letterSpacing: letters.length > 2 ? '-0.5px' : '0.1px',
      fontFamily: "'SF Pro Display', system-ui, -apple-system, sans-serif",
    }}
  >
    {letters}
  </span>
)

const HtmlIcon = ({ active }: { active: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, opacity: active ? 1 : 0.5 }}>
    <path d="M5 4L2 8l3 4" stroke="#E34F26" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M11 4l3 4-3 4" stroke="#E34F26" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M9.5 3l-3 10" stroke="#E34F26" strokeWidth="1.25" strokeLinecap="round"/>
  </svg>
)

const CssIcon = ({ active }: { active: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, opacity: active ? 1 : 0.5 }}>
    <path d="M2.5 4.5h11M2.5 8h7M2.5 11.5h9" stroke="#2965F1" strokeWidth="1.6" strokeLinecap="round"/>
    <circle cx="13" cy="8" r="1.4" fill="#2965F1"/>
  </svg>
)

const JsonIcon = ({ active }: { active: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, opacity: active ? 1 : 0.5 }}>
    <path d="M6 2.5C4.5 2.5 4 3 4 4.5V6c0 1-.6 1.5-1.5 1.5C3.4 7.5 4 8 4 9v1.5C4 12 4.5 12.5 6 12.5"
      stroke="#E5B80B" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M10 2.5c1.5 0 2 .5 2 2V6c0 1 .6 1.5 1.5 1.5C12.6 7.5 12 8 12 9v1.5c0 1.5-.5 2-2 2"
      stroke="#E5B80B" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const MarkdownIcon = ({ active }: { active: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, opacity: active ? 1 : 0.5 }}>
    <path d="M2 11V5l3 3.5L8 5v6" stroke="#7C3AED" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M12 5v6" stroke="#7C3AED" strokeWidth="1.45" strokeLinecap="round"/>
    <path d="M9.5 8.5L12 11l2.5-2.5" stroke="#7C3AED" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const ShellIcon = ({ active }: { active: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, opacity: active ? 1 : 0.5 }}>
    <path d="M2.5 5.5l4 2.5-4 2.5" stroke="#16A34A" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M9 11h5" stroke="#16A34A" strokeWidth="1.6" strokeLinecap="round"/>
  </svg>
)

const YamlIcon = ({ active }: { active: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, opacity: active ? 1 : 0.5 }}>
    <path d="M3 5h10M3 8h6M3 11h8" stroke="#CB171E" strokeWidth="1.6" strokeLinecap="round"/>
    <circle cx="11" cy="8" r="1.4" fill="#CB171E"/>
  </svg>
)

function LanguageIcon({ language, active }: { language?: string; active: boolean }): React.ReactElement {
  switch (language) {
    case 'typescript':      return <LangBadge letters="TS"  bg="#3178C6" active={active} />
    case 'typescriptreact': return <LangBadge letters="TSX" bg="#3178C6" active={active} />
    case 'javascript':      return <LangBadge letters="JS"  bg="#B45309" active={active} />
    case 'javascriptreact': return <LangBadge letters="JSX" bg="#B45309" active={active} />
    case 'python':          return <LangBadge letters="PY"  bg="#2F6FBF" active={active} />
    case 'go':              return <LangBadge letters="GO"  bg="#00909E" active={active} />
    case 'rust':            return <LangBadge letters="RS"  bg="#B7410E" active={active} />
    case 'html':
    case 'xml':             return <HtmlIcon active={active} />
    case 'css':
    case 'scss':
    case 'less':            return <CssIcon active={active} />
    case 'json':
    case 'jsonc':           return <JsonIcon active={active} />
    case 'markdown':        return <MarkdownIcon active={active} />
    case 'yaml':            return <YamlIcon active={active} />
    case 'shellscript':
    case 'shell':
    case 'bash':
    case 'zsh':             return <ShellIcon active={active} />
    case 'c':               return <LangBadge letters="C"   bg="#5C6BC0" active={active} />
    case 'cpp':             return <LangBadge letters="C++" bg="#00599C" active={active} />
    case 'csharp':          return <LangBadge letters="C#"  bg="#239120" active={active} />
    case 'java':            return <LangBadge letters="JV"  bg="#D97706" active={active} />
    case 'ruby':            return <LangBadge letters="RB"  bg="#CC342D" active={active} />
    case 'php':             return <LangBadge letters="PHP" bg="#777BB4" active={active} />
    case 'swift':           return <LangBadge letters="SW"  bg="#F05138" active={active} />
    case 'kotlin':          return <LangBadge letters="KT"  bg="#7F52FF" active={active} />
    case 'dart':            return <LangBadge letters="DT"  bg="#0175C2" active={active} />
    case 'lua':             return <LangBadge letters="LU"  bg="#2C2D72" active={active} />
    case 'r':               return <LangBadge letters="R"   bg="#276DC3" active={active} />
    case 'sql':             return <LangBadge letters="SQL" bg="#E67E22" active={active} />
    case 'dockerfile':      return <LangBadge letters="DK"  bg="#2496ED" active={active} />
    case 'toml':            return <LangBadge letters="TM"  bg="#9C4121" active={active} />
    case 'elixir':          return <LangBadge letters="EX"  bg="#6E4A7E" active={active} />
    case 'haskell':         return <LangBadge letters="HS"  bg="#5D4F85" active={active} />
    case 'scala':           return <LangBadge letters="SC"  bg="#DC322F" active={active} />
    case 'powershell':      return <LangBadge letters="PS"  bg="#012456" active={active} />
    default:
      return <FileIcon color={active ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.28)'} />
  }
}

function tabIcon(tab: Tab, color: string, active: boolean): React.ReactNode {
  switch (tab.type) {
    case 'editor':   return <LanguageIcon language={tab.language} active={active} />
    case 'database': return <DatabaseIcon color={color} />
    case 'preview':  return <PreviewIcon color={color} />
    case 'problems': return <ProblemsIcon />
    case 'config':   return <PaletteIcon color={color} />
    default:         return <LanguageIcon language={tab.language} active={active} />
  }
}

interface CtxMenuState {
  tabId: string
  tab:   Tab
  x:     number
  y:     number
}

export default function TabBar({
  panel: _panel, tabs, activeId, focused: _focused,
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

  const tabBase = "flex items-center gap-[5px] px-[10px] py-[4px] rounded-sm cursor-pointer text-[12px] font-ui whitespace-nowrap shrink-0 text-[var(--tab-color)] transition-[background,color,box-shadow] duration-[100ms] select-none tracking-[0.01em] relative group/tab active:opacity-50 hover:bg-surface-raised hover:text-[var(--tab-color-hover)]"
  const tabActive = " is-active text-[var(--tab-color-hover)] bg-[var(--tab-active-bg,var(--surface-overlay))] shadow-[0_0_0_1px_var(--tab-active-ring,var(--sep-strong))]"
  const closeBtn = "flex items-center justify-center w-[14px] h-[14px] bg-transparent border-0 rounded-xs cursor-pointer text-inherit p-0 shrink-0 opacity-0 transition-[opacity,background] duration-[100ms] ml-px group-hover/tab:opacity-40 group-[.is-active]/tab:opacity-40 hover:opacity-100! hover:bg-surface-overlay"
  const ctxItemBase = "flex items-center w-full px-[14px] py-[7px] bg-transparent border-0 cursor-pointer text-[var(--info-bar-hover-color)] text-left transition-[background] duration-[100ms] whitespace-nowrap font-ui text-[12.5px] hover:bg-surface-raised hover:text-white"

  return (
    <div
      className={`flex items-center bg-[var(--app-bg)] h-full shrink-0 select-none overflow-hidden${dragOver ? ' tabbar--dragover' : ''}`}
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
      <div className="tabbar__strip flex items-center overflow-x-auto overflow-y-hidden flex-1 min-w-0 px-1 py-1 gap-px" style={{ ['--wails-draggable' as any]: 'no-drag' }}>

        {groups.map((group, gi) => {
          const firstTermId = group.terminals[0]?.id
          return (
            <React.Fragment key={firstTermId ?? `g${gi}`}>

              {gi > 0 && <div className="w-px h-4 mx-1 bg-sep shrink-0" />}

              <div className="flex items-center shrink-0 gap-px group/tabgroup">

                {group.terminals.map(term => {
                  const isActive = term.id === activeId
                  const activeStyle = isActive ? {
                    '--tab-active-bg': rgba(group.color, 0.12),
                    '--tab-active-ring': rgba(group.color, 0.28),
                  } as React.CSSProperties : undefined
                  return (
                    <div
                      key={term.id}
                      className={tabBase + (isActive ? tabActive : '')}
                      style={activeStyle}
                      draggable
                      onDragStart={e => { e.dataTransfer.setData('tabId', term.id); e.dataTransfer.effectAllowed = 'move' }}
                      onClick={() => onSelect(term.id)}
                      onContextMenu={e => openCtx(e, term)}
                      title={term.title}
                    >
                      <TerminalIcon color={isActive ? group.color : rgba(group.color, 0.45)} />
                      <span className="max-w-[130px] overflow-hidden text-ellipsis whitespace-nowrap shrink">{term.title}</span>
                      <button className={closeBtn} onClick={e => { e.stopPropagation(); onClose(term.id) }} aria-label="Close">
                        <CloseIcon />
                      </button>
                    </div>
                  )
                })}

                {firstTermId && (
                  <button
                    className="flex items-center justify-center w-5 h-5 rounded-xs bg-transparent border-0 cursor-pointer p-0 shrink-0 opacity-0 transition-[opacity,background] duration-[100ms] group-hover/tabgroup:opacity-[0.35] hover:opacity-100! hover:bg-surface-raised"
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
                  const activeStyle = isActive ? {
                    '--tab-active-bg': rgba(group.color, 0.09),
                    '--tab-active-ring': rgba(group.color, 0.22),
                  } as React.CSSProperties : undefined
                  return (
                    <div
                      key={tab.id}
                      className={tabBase + (isActive ? tabActive : '')}
                      style={activeStyle}
                      draggable
                      onDragStart={e => { e.dataTransfer.setData('tabId', tab.id); e.dataTransfer.effectAllowed = 'move' }}
                      onClick={() => onSelect(tab.id)}
                      onContextMenu={e => openCtx(e, tab)}
                      title={tab.filePath ?? tab.title}
                    >
                      {tabIcon(tab, iconColor, isActive)}
                      <span className="max-w-[130px] overflow-hidden text-ellipsis whitespace-nowrap shrink">{tab.title}</span>
                      <button className={closeBtn} onClick={e => { e.stopPropagation(); onClose(tab.id) }} aria-label="Close">
                        <CloseIcon />
                      </button>
                    </div>
                  )
                })}

              </div>

            </React.Fragment>
          )
        })}

        <button
          className="flex items-center justify-center w-[26px] h-[26px] rounded-xs bg-transparent border-0 cursor-pointer text-[var(--tab-color)] shrink-0 opacity-40 ml-0.5 transition-[opacity,background] duration-[100ms] hover:opacity-100 hover:bg-surface-raised hover:text-[var(--tab-color-hover)]"
          onClick={onNewTerminal}
          title="New terminal"
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
