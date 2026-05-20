import React, { useEffect, useState } from 'react'
import { ReadDatabase } from '../../wailsjs/go/main/App'
import './Database.scss'

interface DBColumn { name: string; type: string }
interface DBTable  { name: string; columns: DBColumn[]; rows: any[][]; row_count: number }
interface DBSchema  { tables: DBTable[] }

interface Props {
  dbPath: string
}

type ViewMode = 'table' | 'json'

// ── icons ──────────────────────────────────────────────────────────────────
const TableIcon = ({ active }: { active: boolean }) => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" style={{ color: active ? '#6ab4fa' : 'currentColor' }}>
    <rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.2"/>
    <path d="M1 5h14M1 9h14M6 5v9" stroke="currentColor" strokeWidth="1.2"/>
  </svg>
)

const JsonIcon = ({ active }: { active: boolean }) => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" style={{ color: active ? '#6ab4fa' : 'currentColor' }}>
    <path d="M4 2C3 2 2 3 2 4v2c0 1-1 2-2 2 1 0 2 1 2 2v2c0 1 1 2 2 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    <path d="M12 2c1 0 2 1 2 2v2c0 1 1 2 2 2-1 0-2 1-2 2v2c0 1-1 2-2 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
  </svg>
)

const DBIcon = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
    <ellipse cx="8" cy="4" rx="6" ry="2.5" stroke="currentColor" strokeWidth="1.2"/>
    <path d="M2 4v4c0 1.38 2.69 2.5 6 2.5S14 9.38 14 8V4" stroke="currentColor" strokeWidth="1.2"/>
    <path d="M2 8v4c0 1.38 2.69 2.5 6 2.5S14 13.38 14 12V8" stroke="currentColor" strokeWidth="1.2"/>
  </svg>
)

export default function Database({ dbPath }: Props) {
  const [schema, setSchema]           = useState<DBSchema | null>(null)
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState('')
  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const [viewMode, setViewMode]       = useState<ViewMode>('table')

  useEffect(() => {
    setLoading(true)
    setError('')
    setSchema(null)
    ReadDatabase(dbPath)
      .then(s => {
        const schema = s as unknown as DBSchema
        setSchema(schema)
        if (schema.tables?.length) setSelectedTable(schema.tables[0].name)
        setLoading(false)
      })
      .catch(e => { setError(String(e)); setLoading(false) })
  }, [dbPath])

  const table = schema?.tables?.find(t => t.name === selectedTable) ?? null

  const tableRows    = table?.rows    ?? []
  const tableCols    = table?.columns ?? []

  const jsonData = tableRows.map(row => {
    const obj: Record<string, any> = {}
    tableCols.forEach((col, i) => { obj[col.name] = row[i] })
    return obj
  })

  const fileName = dbPath.replace(/\\/g, '/').split('/').pop() ?? dbPath

  return (
    <div className="db-container">
      {/* Info bar */}
      <div className="editor-filepath db-infobar">
        <DBIcon />
        <span>{dbPath}</span>
      </div>

      <div className="db-body">
        {/* Sidebar: table list */}
        <aside className="db-sidebar">
          <div className="db-sidebar__header">
            {fileName}
          </div>
          {loading && <div className="db-sidebar__loading">Loading…</div>}
          {error   && <div className="db-sidebar__error">⚠ Could not open database</div>}
          {(schema?.tables ?? []).map(t => (
            <button
              key={t.name}
              className={`db-sidebar__item${t.name === selectedTable ? ' db-sidebar__item--active' : ''}`}
              onClick={() => setSelectedTable(t.name)}
            >
              <DBIcon />
              <span className="db-sidebar__name">{t.name}</span>
              <span className="db-sidebar__count">{t.row_count.toLocaleString()}</span>
            </button>
          ))}
        </aside>

        {/* Main panel */}
        <main className="db-main">
          {loading && <div className="db-status">Reading database…</div>}
          {error   && <div className="db-status db-status--error">{error}</div>}

          {table && (
            <>
              {/* Toolbar */}
              <div className="db-toolbar">
                <span className="db-toolbar__title">{table.name}</span>
                <span className="db-toolbar__meta">
                  {table.row_count.toLocaleString()} rows
                  {tableRows.length < table.row_count ? ` · showing ${tableRows.length}` : ''}
                  {' · '}{tableCols.length} columns
                </span>
                <div className="db-toolbar__spacer" />
                <div className="db-toolbar__toggles">
                  <button
                    className={`db-toggle${viewMode === 'table' ? ' db-toggle--active' : ''}`}
                    onClick={() => setViewMode('table')}
                    title="Table view"
                  >
                    <TableIcon active={viewMode === 'table'} />
                  </button>
                  <button
                    className={`db-toggle${viewMode === 'json' ? ' db-toggle--active' : ''}`}
                    onClick={() => setViewMode('json')}
                    title="JSON view"
                  >
                    <JsonIcon active={viewMode === 'json'} />
                  </button>
                </div>
              </div>

              {/* Table view */}
              {viewMode === 'table' && (
                <div className="db-table-wrap">
                  <table className="db-table">
                    <thead>
                      <tr>
                        <th className="db-table__rownum">#</th>
                        {tableCols.map(col => (
                          <th key={col.name}>
                            <div className="db-col-header">
                              <span className="db-col__name">{col.name}</span>
                              {col.type && <span className="db-col__type">{col.type.toUpperCase()}</span>}
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tableRows.map((row, ri) => (
                        <tr key={ri}>
                          <td className="db-table__rownum">{ri + 1}</td>
                          {(row ?? []).map((cell, ci) => (
                            <td key={ci}>
                              {cell === null || cell === undefined
                                ? <span className="db-null">NULL</span>
                                : String(cell)}
                            </td>
                          ))}
                        </tr>
                      ))}
                      {tableRows.length === 0 && (
                        <tr><td colSpan={tableCols.length + 1} className="db-empty">No rows</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* JSON view */}
              {viewMode === 'json' && (
                <div className="db-json-wrap">
                  <pre className="db-json">{JSON.stringify(jsonData, null, 2)}</pre>
                </div>
              )}
            </>
          )}

          {!loading && !error && !table && (schema?.tables?.length ?? 0) === 0 && (
            <div className="db-status">Database has no tables.</div>
          )}
        </main>
      </div>
    </div>
  )
}
