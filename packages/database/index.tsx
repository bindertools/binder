import React, { useEffect, useState } from 'react'
import type { AppManifest, AppTabProps } from '@binder/app-sdk'
import { invoke } from '../../app/frontend/src/lib/ipc'
import Database from '../../app/frontend/src/components/Database'
import { SearchResult } from '../../app/frontend/src/types'
import SidebarPanel from '../../app/frontend/src/components/shared/SidebarPanel'
import { PageSidebarNavItem } from '../../app/frontend/src/components/shared/PageSidebarNav'
import './index.scss'

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

function DatabasePage({ terminalId, cwd, initialDbPath, privacyMode }: Props) {
  const [dbFiles,    setDbFiles]    = useState<string[]>([])
  const [loading,    setLoading]    = useState(false)
  const [selectedDb, setSelectedDb] = useState<string | null>(initialDbPath ?? null)

  useEffect(() => {
    if (!terminalId) return
    setLoading(true)

    Promise.all([
      invoke<SearchResult[]>('search.files', { path: terminalId, query: '.db' }).catch(() => [] as SearchResult[]),
      invoke<SearchResult[]>('search.files', { path: terminalId, query: '.sqlite' }).catch(() => [] as SearchResult[]),
      invoke<SearchResult[]>('search.files', { path: terminalId, query: '.sqlite3' }).catch(() => [] as SearchResult[]),
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

  const fileItems: PageSidebarNavItem[] = dbFiles.map(path => {
    const parts = path.replace(/\\/g, '/').split('/')
    const name  = parts.pop() ?? path
    const dir   = parts.join('/')
    return {
      id: path,
      label: name,
      icon: <DBFileIcon size={14} />,
      subtitle: dir || undefined,
    }
  })

  return (
    <div className="dbp-root">

      {/* ── Left: file list ───────────────────────────────────────────────── */}
      <SidebarPanel
        title="Database Files"
        headerRight={loading && <span className="flex items-center text-accent animate-spin"><ScanIcon /></span>}
        items={fileItems}
        activeId={selectedDb}
        onSelect={setSelectedDb}
        footer={displayCwd && (
          <div className="px-3.5 py-2 overflow-hidden" title={displayCwd}>
            <span className="block text-[10px] font-mono text-[var(--info-bar-color)] opacity-40 whitespace-nowrap overflow-hidden text-ellipsis">
              {displayCwd}
            </span>
          </div>
        )}
      >
        {!loading && !terminalId && (
          <div className="px-2.5 py-3 text-[12px] text-[var(--info-bar-color)] opacity-45 italic">No active terminal.</div>
        )}

        {!loading && terminalId && dbFiles.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <div className="flex items-center justify-center w-9 h-9 rounded-full bg-surface-raised text-[var(--info-bar-color)] opacity-35 mb-1">
              <DBFileIcon size={18} />
            </div>
            <span className="text-[12px] font-medium text-[var(--info-bar-hover-color)] opacity-55">No databases found</span>
            {displayCwd && (
              <span className="text-[10.5px] font-mono text-[var(--info-bar-color)] opacity-40 break-all leading-[1.4]">{displayCwd}</span>
            )}
          </div>
        )}
      </SidebarPanel>

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

const DatabaseIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <ellipse cx="12" cy="5" rx="9" ry="3"/>
    <path d="M3 5V19A9 3 0 0 0 21 19V5"/>
    <path d="M3 12A9 3 0 0 0 21 12"/>
  </svg>
)

function DatabaseAdapter({ tabId, context }: AppTabProps) {
  const [privacyMode, setPrivacyMode] = useState(false)

  useEffect(() => {
    invoke<{ database_privacy?: boolean }>('config.get')
      .then(cfg => setPrivacyMode(!!cfg.database_privacy))
      .catch(() => {})
  }, [])

  return (
    <DatabasePage
      key={tabId}
      terminalId={context.terminalId ?? null}
      cwd={context.cwd ?? ''}
      initialDbPath={context.focusPath}
      privacyMode={privacyMode}
    />
  )
}

const databaseApp: AppManifest = {
  id: 'database',
  name: 'Database',
  description: 'Browse and query .db/.sqlite files found in the current project.',
  author: 'BinderTools',
  version: '1.0.0',
  tabType: 'database',
  tabTitle: 'Database',
  TabComponent: DatabaseAdapter,
  sidebar: { icon: DatabaseIcon, label: 'Database' },
}

export default databaseApp
