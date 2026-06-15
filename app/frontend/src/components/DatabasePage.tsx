import React, { useEffect, useState } from 'react'
import { SearchFiles } from '../../wailsjs/go/main/App'
import Database from './Database'
import { SearchResult } from '../types'
import './DatabasePage.scss'

interface Props {
  terminalId:     string | null
  cwd:            string
  initialDbPath?: string
  privacyMode?:   boolean
}

const DBFileIcon = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <ellipse cx="12" cy="5" rx="9" ry="3"/>
    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
  </svg>
)

const ScanIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="10" strokeOpacity="0.2"/>
    <path d="M12 2a10 10 0 0110 10"/>
  </svg>
)

export default function DatabasePage({ terminalId, cwd, initialDbPath, privacyMode }: Props) {
  const [dbFiles,    setDbFiles]    = useState<string[]>([])
  const [loading,    setLoading]    = useState(false)
  const [selectedDb, setSelectedDb] = useState<string | null>(initialDbPath ?? null)

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
        .map(r => (r as SearchResult & { abs_path?: string }).abs_path || r.path)
      const unique = [...new Set(all)]
      setDbFiles(unique)
      // Auto-select first file if nothing is selected yet
      if (!selectedDb && unique.length > 0) setSelectedDb(unique[0])
      setLoading(false)
    }).catch(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalId, cwd])

  useEffect(() => {
    if (initialDbPath) setSelectedDb(initialDbPath)
  }, [initialDbPath])

  const displayCwd = cwd.replace(/\\/g, '/')

  return (
    <div className="dbp-root">

      {/* ── Left: file list ───────────────────────────────────────────────── */}
      <aside className="dbp-sidebar">
        <div className="dbp-sidebar-header">
          <span>Database Files</span>
          {loading && <span className="dbp-scanning-icon"><ScanIcon /></span>}
        </div>

        <div className="dbp-sidebar-body">

          {!loading && !terminalId && (
            <div className="dbp-sidebar-msg">No active terminal.</div>
          )}

          {!loading && terminalId && dbFiles.length === 0 && (
            <div className="dbp-no-files">
              <div className="dbp-no-files-icon"><DBFileIcon size={18} /></div>
              <span className="dbp-no-files-title">No databases found</span>
              {displayCwd && (
                <span className="dbp-no-files-path">{displayCwd}</span>
              )}
            </div>
          )}

          {dbFiles.map(path => {
            const parts = path.replace(/\\/g, '/').split('/')
            const name  = parts.pop() ?? path
            const dir   = parts.join('/')
            const isActive = selectedDb === path
            return (
              <button
                key={path}
                className={`dbp-file-item${isActive ? ' is-active' : ''}`}
                onClick={() => setSelectedDb(path)}
              >
                <span className="dbp-file-icon"><DBFileIcon size={14} /></span>
                <div className="dbp-file-info">
                  <span className="dbp-file-name">{name}</span>
                  {dir && <span className="dbp-file-dir">{dir}</span>}
                </div>
              </button>
            )
          })}
        </div>

        {displayCwd && (
          <div className="dbp-cwd-bar" title={displayCwd}>
            <span className="dbp-cwd-text">{displayCwd}</span>
          </div>
        )}
      </aside>

      {/* ── Divider ───────────────────────────────────────────────────────── */}
      <div className="dbp-divider" />

      {/* ── Right: database viewer ────────────────────────────────────────── */}
      <main className="dbp-main">
        {selectedDb ? (
          <Database dbPath={selectedDb} privacyMode={privacyMode} />
        ) : (
          <div className="dbp-main-empty">
            <div className="dbp-main-empty-icon"><DBFileIcon size={26} /></div>
            <span className="dbp-main-empty-title">
              {loading ? 'Scanning for databases…' : 'Select a database'}
            </span>
            <span className="dbp-main-empty-sub">
              {loading
                ? 'Looking for .db and .sqlite files'
                : dbFiles.length > 0
                  ? `${dbFiles.length} file${dbFiles.length !== 1 ? 's' : ''} found: choose one on the left`
                  : 'No .db or .sqlite files found in this directory'
              }
            </span>
          </div>
        )}
      </main>
    </div>
  )
}
