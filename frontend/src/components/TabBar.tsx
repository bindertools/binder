import React from 'react'
import { Tab } from '../types'
import {
  WindowMinimise,
  WindowToggleMaximise,
  Quit,
} from '../../wailsjs/runtime/runtime'
import './TabBar.css'

interface Props {
  tabs: Tab[]
  activeId: string
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onNewTerminal: () => void
}

const TERMINAL_COLORS = [
  '#4fc3f7',
  '#81c995',
  '#ffb74d',
  '#f48fb1',
  '#ce93d8',
  '#80cbc4',
  '#bcaaa4',
]

interface Group {
  terminal: Tab | null
  color: string
  files: Tab[]
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function buildGroups(tabs: Tab[]): Group[] {
  const groups: Group[] = []
  const terminalColor = new Map<string, string>()
  let colorIdx = 0

  for (const tab of tabs) {
    if (tab.type === 'terminal') {
      const color = TERMINAL_COLORS[colorIdx % TERMINAL_COLORS.length]
      colorIdx++
      terminalColor.set(tab.id, color)
      groups.push({ terminal: tab, color, files: [] })
    } else {
      const group = groups.find(g => g.terminal?.id === tab.parentId)
      if (group) {
        group.files.push(tab)
      } else if (groups.length > 0) {
        groups[groups.length - 1].files.push(tab)
      } else {
        groups.push({ terminal: null, color: '#555', files: [tab] })
      }
    }
  }

  return groups
}

const CloseIcon = () => (
  <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
    <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
)

// No-drag wrapper so interactive elements inside the draggable tabbar still work
const NoDrag: React.FC<{ children: React.ReactNode; className?: string; style?: React.CSSProperties; onClick?: () => void }> = ({ children, className, style, onClick }) => (
  <div className={className} style={{ ...style, ['--wails-draggable' as any]: 'no-drag' }} onClick={onClick}>
    {children}
  </div>
)

export default function TabBar({ tabs, activeId, onSelect, onClose, onNewTerminal }: Props) {
  const groups = buildGroups(tabs)

  return (
    // The entire tabbar is a drag region; interactive children opt out with no-drag
    <div className="tabbar" style={{ ['--wails-draggable' as any]: 'drag' }} onDoubleClick={WindowToggleMaximise}>

      {/* Tab groups */}
      <div className="tabbar__groups" style={{ ['--wails-draggable' as any]: 'no-drag' }}>
        {groups.map((group, gi) => (
          <div
            key={group.terminal?.id ?? `g${gi}`}
            className="tabbar__group"
            style={{
              borderColor: hexToRgba(group.color, 0.28),
              backgroundColor: hexToRgba(group.color, 0.05),
            }}
          >
            {group.terminal && (
              <div
                className={`tabbar__tab tabbar__tab--terminal${group.terminal.id === activeId ? ' tabbar__tab--active' : ''}`}
                style={group.terminal.id === activeId
                  ? { backgroundColor: hexToRgba(group.color, 0.14), color: '#ddd' }
                  : undefined}
                onClick={() => onSelect(group.terminal!.id)}
              >
                <svg
                  className="tabbar__terminal-icon"
                  width="14" height="14" viewBox="0 0 16 16" fill="none"
                  style={{ color: group.color, opacity: group.terminal.id === activeId ? 1 : 0.55 }}
                >
                  <rect x="1" y="1" width="14" height="14" rx="3" stroke="currentColor" strokeWidth="1.2"/>
                  <path d="M4.5 5.5L7.5 8L4.5 10.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M8.5 10.5H11.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                </svg>
                <button
                  className="tabbar__close"
                  onClick={e => { e.stopPropagation(); onClose(group.terminal!.id) }}
                  aria-label="Close"
                >
                  <CloseIcon />
                </button>
              </div>
            )}

            {group.files.map(tab => (
              <div
                key={tab.id}
                className={`tabbar__tab tabbar__tab--file${tab.id === activeId ? ' tabbar__tab--active' : ''}`}
                style={tab.id === activeId
                  ? { backgroundColor: hexToRgba(group.color, 0.14), color: '#ddd' }
                  : undefined}
                onClick={() => onSelect(tab.id)}
              >
                <span className="tabbar__dot tabbar__dot--file" style={{ background: group.color }} />
                <span className="tabbar__title">{tab.title}</span>
                <button
                  className="tabbar__close"
                  onClick={e => { e.stopPropagation(); onClose(tab.id) }}
                  aria-label="Close"
                >
                  <CloseIcon />
                </button>
              </div>
            ))}
          </div>
        ))}

        {/* New terminal */}
        <button className="tabbar__add" onClick={onNewTerminal} aria-label="New terminal">
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      {/* Spacer — draggable */}
      <div className="tabbar__spacer" />

      {/* Window controls */}
      <div className="tabbar__wincontrols" style={{ ['--wails-draggable' as any]: 'no-drag' }}>
        <button className="wc-btn wc-min" onClick={WindowMinimise} aria-label="Minimise">
          <svg width="10" height="2" viewBox="0 0 10 2">
            <path d="M0 1h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
        <button className="wc-btn wc-max" onClick={WindowToggleMaximise} aria-label="Maximise">
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect x="0.75" y="0.75" width="8.5" height="8.5" rx="1.5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
          </svg>
        </button>
        <button className="wc-btn wc-close" onClick={Quit} aria-label="Close">
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
    </div>
  )
}
