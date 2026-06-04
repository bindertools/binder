import React, { useEffect, useState } from 'react'
import { SearchFiles } from '../../wailsjs/go/main/App'
import Database from './Database'
import { SearchResult } from '../types'

interface Props {
  terminalId:     string | null
  cwd:            string
  initialDbPath?: string
}

const DBFileIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <ellipse cx="12" cy="5" rx="9" ry="3"/>
    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
  </svg>
)

const BackIcon = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 4L6 8l4 4"/>
  </svg>
)

const ChevronIcon = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 4l4 4-4 4"/>
  </svg>
)

export default function DatabasePage({ terminalId, cwd, initialDbPath }: Props) {
  const [dbFiles,      setDbFiles]      = useState<string[]>([])
  const [loading,      setLoading]      = useState(false)
  const [selectedDb,   setSelectedDb]   = useState<string | null>(initialDbPath ?? null)

  // Re-scan whenever the terminal or cwd changes
  useEffect(() => {
    if (!terminalId) return
    setLoading(true)

    Promise.all([
      SearchFiles(terminalId, '.db').catch(() => [] as SearchResult[]),
      SearchFiles(terminalId, '.sqlite').catch(() => [] as SearchResult[]),
      SearchFiles(terminalId, '.sqlite3').catch(() => [] as SearchResult[]),
    ]).then(([a, b, c]) => {
      const all = ([...a, ...b, ...c] as SearchResult[])
        .filter(r => r.is_name)
        .map(r => r.path)
      setDbFiles([...new Set(all)])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [terminalId, cwd])

  // Sync if caller passes a new initial path
  useEffect(() => {
    if (initialDbPath) setSelectedDb(initialDbPath)
  }, [initialDbPath])

  if (selectedDb) {
    return (
      <div className="flex flex-col h-full bg-[var(--app-bg)]">
        <div className="flex items-center h-[38px] px-3 border-b border-[var(--border-color)] shrink-0 gap-2">
          <button
            className="flex items-center gap-1.5 text-[var(--tab-color)] text-[11.5px] font-ui hover:text-[var(--tab-color-hover)] transition-colors duration-100 border-0 bg-transparent cursor-pointer p-0"
            onClick={() => setSelectedDb(null)}
          >
            <BackIcon />
            All databases
          </button>
          <span className="text-[var(--tab-color)] opacity-20">|</span>
          <span className="text-[var(--tab-color)] text-[11.5px] font-mono opacity-60 truncate">
            {selectedDb.replace(/\\/g, '/').split('/').pop()}
          </span>
        </div>
        <div className="flex-1 overflow-hidden">
          <Database dbPath={selectedDb} />
        </div>
      </div>
    )
  }

  const displayCwd = cwd.replace(/\\/g, '/')

  return (
    <div className="flex flex-col h-full bg-[var(--app-bg)]">
      {/* Page header */}
      <div className="flex items-center gap-3 h-[38px] px-4 border-b border-[var(--border-color)] shrink-0">
        <span className="text-[var(--tab-color-hover)] text-[12px] font-ui font-medium">Database</span>
        {displayCwd && (
          <span className="text-[var(--tab-color)] opacity-35 text-[11px] font-mono truncate">{displayCwd}</span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {loading && (
          <div className="flex items-center gap-2 text-[var(--tab-color)] opacity-40 text-[12px]">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
              <circle cx="12" cy="12" r="10" strokeOpacity="0.2"/>
              <path d="M12 2a10 10 0 0110 10" strokeLinecap="round"/>
            </svg>
            Scanning…
          </div>
        )}

        {!loading && !terminalId && (
          <p className="text-[var(--tab-color)] opacity-40 text-[12px]">No active terminal.</p>
        )}

        {!loading && terminalId && dbFiles.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 text-center gap-3">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--tab-color)] opacity-15">
              <ellipse cx="12" cy="5" rx="9" ry="3"/>
              <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
              <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
            </svg>
            <div>
              <p className="text-[var(--tab-color)] opacity-40 text-[12.5px]">No .db or .sqlite files found</p>
              {displayCwd && (
                <p className="text-[var(--tab-color)] opacity-25 text-[11px] font-mono mt-1">{displayCwd}</p>
              )}
            </div>
          </div>
        )}

        {!loading && dbFiles.length > 0 && (
          <div className="flex flex-col gap-1 max-w-[640px]">
            <p className="text-[var(--tab-color)] opacity-35 text-[10.5px] uppercase tracking-wider mb-2">
              {dbFiles.length} database file{dbFiles.length !== 1 ? 's' : ''} found
            </p>
            {dbFiles.map(path => {
              const parts = path.replace(/\\/g, '/').split('/')
              const name  = parts.pop() ?? path
              const dir   = parts.join('/')
              return (
                <button
                  key={path}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-transparent border border-sep text-left cursor-pointer transition-[background,border-color] duration-100 hover:bg-surface-raised hover:border-sep-strong group"
                  onClick={() => setSelectedDb(path)}
                >
                  <span className="text-[var(--tab-color)] opacity-40 shrink-0 group-hover:opacity-70 transition-opacity duration-100">
                    <DBFileIcon />
                  </span>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-[var(--tab-color-hover)] text-[13px] font-ui font-medium">{name}</span>
                    {dir && (
                      <span className="text-[var(--tab-color)] opacity-35 text-[10.5px] font-mono truncate mt-[1px]">{dir}</span>
                    )}
                  </div>
                  <span className="text-[var(--tab-color)] opacity-0 group-hover:opacity-30 transition-opacity duration-100 shrink-0">
                    <ChevronIcon />
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
