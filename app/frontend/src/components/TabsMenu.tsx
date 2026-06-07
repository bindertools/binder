import React, { useState, useEffect, useRef, useMemo } from 'react'
import { Tab } from '../types'

interface Props {
  open:          boolean
  tabs:          Tab[]
  activeId:      string
  rightActiveId: string
  tabPanels:     Record<string, 'left' | 'right'>
  terminalCwds:  Record<string, string>
  onSelect:      (id: string) => void
  onClose:       (id: string) => void
  onDismiss:     () => void
}

// ── icons ─────────────────────────────────────────────────────────────────────
const IcoTerminal = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="1" width="14" height="14" rx="2"/>
    <path d="M4 5l3 3-3 3M9 11h4"/>
  </svg>
)
const IcoFile = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 1h6l4 4v10a1 1 0 01-1 1H3a1 1 0 01-1-1V2a1 1 0 011-1z"/>
    <path d="M10 1v4h4"/>
  </svg>
)
const IcoPreview = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
    <rect x="1" y="2" width="14" height="12" rx="1.5"/>
    <path d="M1 6h14"/>
    <circle cx="8" cy="10" r="2"/>
  </svg>
)
const IcoDb = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
    <ellipse cx="8" cy="4" rx="6" ry="2.5"/>
    <path d="M2 4v8c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V4"/>
    <path d="M2 8c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5"/>
  </svg>
)
const IcoTab = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
    <rect x="1" y="1" width="5.5" height="5.5" rx="1"/>
    <rect x="9.5" y="1" width="5.5" height="5.5" rx="1"/>
    <rect x="1" y="9.5" width="5.5" height="5.5" rx="1"/>
    <rect x="9.5" y="9.5" width="5.5" height="5.5" rx="1"/>
  </svg>
)

const TabTypeIcon = ({ type }: { type: string }) => {
  switch (type) {
    case 'terminal':  return <IcoTerminal />
    case 'editor':    return <IcoFile />
    case 'preview':   return <IcoPreview />
    case 'database':  return <IcoDb />
    default:          return <IcoTab />
  }
}

// ── group ordering & labels ───────────────────────────────────────────────────
const GROUP_ORDER  = ['terminal','editor','preview','database','debug','config','ports','perf','fullscreen','plugins']
const GROUP_LABELS: Record<string, string> = {
  terminal:   'Terminals',
  editor:     'Files',
  preview:    'Previews',
  database:   'Databases',
  debug:      'Debug',
  config:     'Settings',
  ports:      'Ports',
  perf:       'Performance',
  fullscreen: 'Fullscreen',
  plugins:    'Plugins',
}

// ── component ─────────────────────────────────────────────────────────────────
export default function TabsMenu({
  open, tabs, activeId, rightActiveId, tabPanels, terminalCwds,
  onSelect, onClose, onDismiss,
}: Props) {
  const [query, setQuery]   = useState('')
  const inputRef            = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setTimeout(() => inputRef.current?.focus(), 40)
    }
  }, [open])

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    if (!q) return tabs
    return tabs.filter(t => {
      const title = t.title.toLowerCase()
      const meta  = (t.filePath ?? t.dbPath ?? t.problemsCwd ?? '').toLowerCase()
      return title.includes(q) || meta.includes(q)
    })
  }, [tabs, query])

  const groups = useMemo(() => {
    const g: Record<string, Tab[]> = {}
    for (const t of filtered) {
      ;(g[t.type] ??= []).push(t)
    }
    return g
  }, [filtered])

  const orderedTypes = useMemo(() => {
    const types = Object.keys(groups)
    const head  = GROUP_ORDER.filter(t => types.includes(t))
    const tail  = types.filter(t => !GROUP_ORDER.includes(t))
    return [...head, ...tail]
  }, [groups])

  const subtitle = (t: Tab) => {
    if (t.type === 'terminal') return (terminalCwds[t.id] ?? '').replace(/\\/g, '/')
    if (t.type === 'editor')   return (t.filePath  ?? '').replace(/\\/g, '/')
    if (t.type === 'database') return (t.dbPath    ?? '').replace(/\\/g, '/')
    if (t.type === 'debug') return (t.problemsCwd ?? '').replace(/\\/g, '/')
    return ''
  }

  const isActive = (id: string) => id === activeId || id === rightActiveId

  if (!open) return null

  return (
    <>
      {/* click-away backdrop */}
      <div className="fixed inset-0 z-[9996]" onClick={onDismiss} />

      {/* drawer panel */}
      <div className="fixed top-[42px] left-0 z-[9997] w-[290px] flex flex-col bg-[var(--info-bar-bg)] border-r border-b border-[var(--border-color)] rounded-br-xl shadow-[var(--shadow-overlay)] max-h-[calc(100vh-52px)]">

        {/* ── search ─────────────────────────────────────────────────────────── */}
        <div className="px-2.5 py-2 border-b border-[var(--border-color)] shrink-0">
          <div className="flex items-center gap-2 bg-[var(--app-bg)] rounded-md px-2.5 h-7 border border-[var(--border-color)]">
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" className="shrink-0 opacity-40" style={{ color: 'var(--tab-color)' }}>
              <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M10.5 10.5l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Filter tabs…"
              className="flex-1 bg-transparent border-0 outline-none text-[var(--info-bar-hover-color)] font-ui text-[12px] placeholder-[var(--tab-color)]"
              onKeyDown={e => {
                if (e.key === 'Escape') { e.stopPropagation(); onDismiss() }
              }}
              spellCheck={false}
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="shrink-0 flex items-center justify-center w-3.5 h-3.5 rounded text-[var(--tab-color)] hover:text-[var(--tab-color-hover)] transition-colors"
              >
                <svg width="8" height="8" viewBox="0 0 10 10"><path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              </button>
            )}
          </div>
        </div>

        {/* ── tab list ───────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto no-scrollbar py-1">
          {orderedTypes.map(type => {
            const groupTabs = groups[type] ?? []
            if (groupTabs.length === 0) return null
            return (
              <div key={type}>
                <div className="px-3 pt-2.5 pb-0.5 text-[9.5px] font-semibold tracking-[0.1em] uppercase text-[var(--tab-color)] opacity-50 select-none">
                  {GROUP_LABELS[type] ?? type}
                </div>
                {groupTabs.map(t => {
                  const active = isActive(t.id)
                  const sub    = subtitle(t)
                  return (
                    <div
                      key={t.id}
                      className={`group flex items-center gap-2 px-2.5 py-[5px] cursor-pointer transition-[background] duration-[70ms] ${active ? 'bg-[rgba(10,132,255,0.12)]' : 'hover:bg-surface-raised'}`}
                      onClick={() => { onSelect(t.id); onDismiss() }}
                    >
                      {/* active dot */}
                      <div className={`w-[5px] h-[5px] rounded-full shrink-0 transition-colors ${active ? 'bg-accent' : 'bg-transparent'}`} />

                      {/* type icon */}
                      <span className={`shrink-0 transition-colors ${active ? 'text-accent' : 'text-[var(--tab-color)]'}`}>
                        <TabTypeIcon type={t.type} />
                      </span>

                      {/* title + path */}
                      <div className="flex-1 min-w-0">
                        <div className={`text-[12.5px] truncate leading-[1.35] transition-colors ${active ? 'text-[var(--tab-color-hover)]' : 'text-[var(--tab-color)]'}`}>
                          {t.title}
                        </div>
                        {sub && (
                          <div className="text-[10px] truncate text-[var(--tab-color)] opacity-50 leading-[1.3] font-mono">
                            {sub}
                          </div>
                        )}
                      </div>

                      {/* panel badge */}
                      {tabPanels[t.id] === 'right' && (
                        <span className="text-[8.5px] px-1 py-px rounded bg-surface-overlay text-[var(--tab-color)] opacity-50 shrink-0 font-mono">R</span>
                      )}

                      {/* close */}
                      <button
                        className="shrink-0 w-[18px] h-[18px] rounded flex items-center justify-center text-[var(--tab-color)] opacity-0 group-hover:opacity-70 hover:!opacity-100 hover:bg-surface-overlay hover:text-[var(--tab-color-hover)] transition-[opacity,background] duration-[70ms]"
                        onClick={e => { e.stopPropagation(); onClose(t.id) }}
                        title="Close tab"
                      >
                        <svg width="7" height="7" viewBox="0 0 10 10">
                          <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                        </svg>
                      </button>
                    </div>
                  )
                })}
              </div>
            )
          })}

          {filtered.length === 0 && (
            <div className="px-4 py-8 text-center text-[11px] text-[var(--tab-color)] opacity-50">
              No tabs match "{query}"
            </div>
          )}
        </div>

        {/* ── footer ─────────────────────────────────────────────────────────── */}
        <div className="shrink-0 px-3 py-1.5 border-t border-[var(--border-color)] flex items-center justify-between">
          <span className="text-[10.5px] text-[var(--tab-color)] opacity-40">
            {tabs.length} {tabs.length === 1 ? 'tab' : 'tabs'}
          </span>
          <span className="text-[10.5px] text-[var(--tab-color)] opacity-30 font-mono">Ctrl+`</span>
        </div>
      </div>
    </>
  )
}
