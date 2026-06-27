import React, { useState, useEffect, useRef } from 'react'
import ReactDOM from 'react-dom'
import { Tab, SearchResult } from '../types'
import { invoke } from '../lib/ipc'
import './SearchPalette.scss'

interface Props {
  tabs:              Tab[]
  activeTerminalId:  string | null
  onSelectTab:       (id: string) => void
  onOpenFile:        (path: string, line?: number) => void
  onClose:           () => void
}

type Item =
  | { kind: 'tab';  tab: Tab }
  | { kind: 'file'; result: SearchResult }

export default function SearchPalette({ tabs, activeTerminalId, onSelectTab, onOpenFile, onClose }: Props) {
  const [query, setQuery]           = useState('')
  const [fileResults, setFileResults] = useState<SearchResult[]>([])
  const [selectedIdx, setSelectedIdx] = useState(0)
  const inputRef  = useRef<HTMLInputElement>(null)
  const listRef   = useRef<HTMLDivElement>(null)
  const debounce  = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    if (!query.trim() || !activeTerminalId) { setFileResults([]); return }
    debounce.current = setTimeout(() => {
      invoke<SearchResult[]>('search.files', { path: activeTerminalId, query })
        .then(r => { setFileResults(r ?? []); setSelectedIdx(0) })
        .catch(() => {})
    }, 200)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [query, activeTerminalId])

  const filteredTabs: Tab[] = query.trim()
    ? tabs.filter(t =>
        t.title.toLowerCase().includes(query.toLowerCase()) ||
        (t.filePath?.toLowerCase().includes(query.toLowerCase()))
      )
    : tabs.slice(0, 10)

  const items: Item[] = [
    ...filteredTabs.map(t => ({ kind: 'tab' as const, tab: t })),
    ...fileResults.map(r => ({ kind: 'file' as const, result: r })),
  ]

  // Keep selected item visible
  useEffect(() => {
    if (!listRef.current) return
    const el = listRef.current.children[selectedIdx] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIdx])

  function activate(item: Item) {
    if (item.kind === 'tab') onSelectTab(item.tab.id)
    else onOpenFile(item.result.path, item.result.line || undefined)
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, items.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)) }
    if (e.key === 'Enter') {
      const item = items[selectedIdx]
      if (item) activate(item)
    }
  }

  const tabCount  = filteredTabs.length
  const fileCount = fileResults.length

  return ReactDOM.createPortal(
    <div className="palette-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="palette">
        <div className="palette__bar">
          <svg className="palette__search-icon" width="14" height="14" viewBox="0 0 16 16" fill="none">
            <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M10.5 10.5l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input
            ref={inputRef}
            className="palette__input"
            placeholder="Search files and tabs…"
            value={query}
            onChange={e => { setQuery(e.target.value); setSelectedIdx(0) }}
            onKeyDown={handleKey}
            spellCheck={false}
          />
          <kbd className="palette__esc" onClick={onClose}>esc</kbd>
        </div>

        {items.length > 0 && (
          <div className="palette__list" ref={listRef}>
            {tabCount > 0 && <div className="palette__section">Open Tabs</div>}
            {filteredTabs.map((tab, i) => (
              <div
                key={tab.id}
                className={`palette__item${i === selectedIdx ? ' is-selected' : ''}`}
                onMouseDown={() => activate({ kind: 'tab', tab })}
                onMouseEnter={() => setSelectedIdx(i)}
              >
                <span className="palette__item-name">{tab.title}</span>
                {tab.filePath && (
                  <span className="palette__item-path">
                    {tab.filePath.replace(/\\/g, '/').split('/').slice(-3, -1).join('/')}
                  </span>
                )}
                <span className="palette__item-badge">{tab.type}</span>
              </div>
            ))}

            {fileCount > 0 && <div className="palette__section">Files</div>}
            {fileResults.map((r, i) => {
              const absIdx = tabCount + i
              const fileName = r.path.replace(/\\/g, '/').split('/').pop() ?? r.path
              const dir      = r.path.replace(/\\/g, '/').split('/').slice(-4, -1).join('/')
              return (
                <div
                  key={`${r.path}:${r.line}:${i}`}
                  className={`palette__item${absIdx === selectedIdx ? ' is-selected' : ''}`}
                  onMouseDown={() => activate({ kind: 'file', result: r })}
                  onMouseEnter={() => setSelectedIdx(absIdx)}
                >
                  <span className="palette__item-name">{fileName}</span>
                  <span className="palette__item-path">
                    {dir}{r.line ? `:${r.line}` : ''}
                  </span>
                  {r.content && !r.is_name && (
                    <span className="palette__item-content">{r.content.trim()}</span>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {items.length === 0 && query.trim() && (
          <div className="palette__empty">No results for "{query}"</div>
        )}
      </div>
    </div>,
    document.body
  )
}
