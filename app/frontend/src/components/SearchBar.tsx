import React, { useEffect, useRef, useState, useCallback } from 'react'
import { SearchResult } from '../types'
import { SearchFiles } from '../../wailsjs/go/main/App'
import './SearchBar.scss'

interface Props {
  activeTerminalId: string | null
  onOpenFile: (path: string, line?: number) => void
}

export default function SearchBar({ activeTerminalId, onOpenFile }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [open, setOpen] = useState(false)
  const [selectedIdx, setSelectedIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const search = useCallback((q: string) => {
    if (!q || !activeTerminalId) { setResults([]); return }
    SearchFiles(activeTerminalId, q)
      .then(r => { setResults(r ?? []); setSelectedIdx(0) })
      .catch(() => {})
  }, [activeTerminalId])

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    if (!query) { setResults([]); setOpen(false); return }
    debounce.current = setTimeout(() => { search(query); setOpen(true) }, 250)
  }, [query, search])

  const handleKey = (e: React.KeyboardEvent) => {
    if (!open || results.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, results.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)) }
    if (e.key === 'Enter') {
      const r = results[selectedIdx]
      if (r) { onOpenFile(r.path, r.line || undefined); setQuery(''); setOpen(false) }
    }
    if (e.key === 'Escape') { setOpen(false); setQuery('') }
  }

  function highlight(text: string): React.ReactNode {
    const idx = text.toLowerCase().indexOf(query.toLowerCase())
    if (idx < 0) return text
    return <>{text.slice(0, idx)}<mark className="search__hi">{text.slice(idx, idx + query.length)}</mark>{text.slice(idx + query.length)}</>
  }

  const nameResults    = results.filter(r => r.is_name)
  const contentResults = results.filter(r => !r.is_name)

  return (
    <div className="search">
      <input
        ref={inputRef}
        className="search__input"
        placeholder="search files…"
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={handleKey}
        onFocus={() => query && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && results.length > 0 && (
        <div className="search__dropdown">
          {nameResults.length > 0 && (
            <>
              <div className="search__section">Files</div>
              {nameResults.map((r, i) => {
                const absIdx = i
                return (
                  <div
                    key={r.path}
                    className={`search__row${absIdx === selectedIdx ? ' search__row--sel' : ''}`}
                    onMouseDown={() => { onOpenFile(r.path); setQuery(''); setOpen(false) }}
                  >
                    <span className="search__path">{highlight(r.path)}</span>
                  </div>
                )
              })}
            </>
          )}
          {contentResults.length > 0 && (
            <>
              <div className="search__section">Content</div>
              {contentResults.map((r, i) => {
                const absIdx = nameResults.length + i
                return (
                  <div
                    key={`${r.path}:${r.line}`}
                    className={`search__row${absIdx === selectedIdx ? ' search__row--sel' : ''}`}
                    onMouseDown={() => { onOpenFile(r.path, r.line); setQuery(''); setOpen(false) }}
                  >
                    <span className="search__path">{r.path}</span>
                    <span className="search__line">:{r.line}</span>
                    <span className="search__content">{highlight(r.content)}</span>
                  </div>
                )
              })}
            </>
          )}
        </div>
      )}
    </div>
  )
}
