import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { invoke } from '../lib/ipc'
import SidebarPanel from './shared/SidebarPanel'
import { PageSidebarNavItem } from './shared/PageSidebarNav'
import ContextMenu, { ContextMenuEntry } from './ContextMenu'
import './Database.scss'

interface DBColumn { name: string; type: string; notnull?: boolean; pk?: boolean }
interface DBTable  { name: string; columns: DBColumn[]; rows: any[][]; row_count: number; has_rowid?: boolean; rowids?: number[] }
interface DBSchema  { tables: DBTable[] }

// Wraps an identifier in double quotes for use in generated SQL, escaping any
// embedded quotes so table/column names round-trip safely.
function quoteIdent(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"'
}

// Builds a WHERE clause that addresses exactly one row. Prefers the SQLite
// rowid (fetched alongside the row data); falls back to matching on every
// column's value for WITHOUT ROWID tables, which can be ambiguous for
// duplicate rows but is the best available option.
function rowWhere(table: DBTable, ri: number): { clause: string; params: any[] } | null {
  if (table.has_rowid && table.rowids) {
    const rid = table.rowids[ri]
    if (rid === undefined) return null
    return { clause: 'rowid = ?', params: [rid] }
  }
  const row = table.rows[ri]
  if (!row) return null
  const clauses: string[] = []
  const params: any[] = []
  table.columns.forEach((col, i) => {
    const v = row[i]
    if (v === null || v === undefined) {
      clauses.push(`${quoteIdent(col.name)} IS NULL`)
    } else {
      clauses.push(`${quoteIdent(col.name)} = ?`)
      params.push(v)
    }
  })
  return { clause: clauses.join(' AND '), params }
}

interface Props {
  dbPath:       string
  privacyMode?: boolean
}

type ViewMode = 'table' | 'json'

// ── Icons ─────────────────────────────────────────────────────────────────────

const DBIcon = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <ellipse cx="8" cy="4.5" rx="5.5" ry="2"/>
    <path d="M2.5 4.5v3c0 1.1 2.46 2 5.5 2s5.5-.9 5.5-2v-3"/>
    <path d="M2.5 7.5v3c0 1.1 2.46 2 5.5 2s5.5-.9 5.5-2v-3"/>
  </svg>
)

const TableIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/>
    <path d="M1.5 6.5h13M6 6.5v7"/>
  </svg>
)

const GridIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
    <rect x="1" y="1" width="14" height="14" rx="2"/>
    <path d="M1 5.5h14M1 10.5h14M5.5 1v14M10.5 1v14"/>
  </svg>
)

const JsonIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
    <path d="M4.5 2C3.5 2 2.5 3 2.5 4v2c0 1-.75 1.5-1.5 2 .75.5 1.5 1 1.5 2v2c0 1 1 2 2 2"/>
    <path d="M11.5 2c1 0 2 1 2 2v2c0 1 .75 1.5 1.5 2-.75.5-1.5 1-1.5 2v2c0 1-1 2-2 2"/>
  </svg>
)

const FilterIcon = () => (
  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 4h12M4 8h8M6 12h4"/>
  </svg>
)

const EyeOffIcon = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 2l12 12"/>
    <path d="M6.5 6.6A2 2 0 009.4 9.5"/>
    <path d="M3.2 4.4C1.8 5.5 1 7 1 8c0 2 3 5 7 5a8.3 8.3 0 003.8-.9"/>
    <path d="M12.8 11.6C14.2 10.5 15 9 15 8c0-2-3-5-7-5a8.3 8.3 0 00-3.8.9"/>
  </svg>
)

const WarningIcon = () => (
  <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
    <path d="M7 1.8L12.4 11.5H1.6L7 1.8Z" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
    <path d="M7 5.5V8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    <circle cx="7" cy="10.2" r="0.7" fill="currentColor"/>
  </svg>
)

// ── JSON syntax highlighter ───────────────────────────────────────────────────

function JsonView({
  rows,
  columns,
  privacyMode,
  jsonRevealed,
  onReveal,
  onHide,
}: {
  rows:          any[][]
  columns:       DBColumn[]
  privacyMode?:  boolean
  jsonRevealed:  boolean
  onReveal:      () => void
  onHide:        () => void
}) {
  const data = useMemo(
    () => rows.map(row => {
      const obj: Record<string, any> = {}
      columns.forEach((col, i) => { obj[col.name] = row[i] })
      return obj
    }),
    [rows, columns],
  )

  const raw = JSON.stringify(data, null, 2)
  const highlighted = raw.replace(
    /("(?:\\u[0-9a-fA-F]{4}|\\[^u]|[^"\\])*"(?:\s*:)?|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    match => {
      if (match.endsWith(':')) return `<span class="dj-key">${match}</span>`
      if (match.startsWith('"'))  return `<span class="dj-str">${match}</span>`
      if (match === 'true' || match === 'false') return `<span class="dj-bool">${match}</span>`
      if (match === 'null') return `<span class="dj-null">${match}</span>`
      return `<span class="dj-num">${match}</span>`
    },
  )

  if (privacyMode && !jsonRevealed) {
    return (
      <div className="db-json-privacy-wrap" onClick={onReveal} title="Click to reveal">
        <pre
          className="db-json db-json--blurred"
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
        <div className="db-json-privacy-overlay">
          <EyeOffIcon />
          <span>Click to reveal</span>
        </div>
      </div>
    )
  }

  return (
    <div className="db-json-revealed-wrap">
      {privacyMode && (
        <button className="db-json-rehide-btn" onClick={onHide} title="Re-blur data">
          <EyeOffIcon /> Hide
        </button>
      )}
      <pre
        className="db-json"
        dangerouslySetInnerHTML={{ __html: highlighted }}
      />
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Database({ dbPath, privacyMode }: Props) {
  const [schema,        setSchema]        = useState<DBSchema | null>(null)
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState('')
  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const [viewMode,      setViewMode]      = useState<ViewMode>('table')
  const [filter,        setFilter]        = useState('')
  const [revealedCells, setRevealedCells] = useState<Set<string>>(new Set())
  const [jsonRevealed,  setJsonRevealed]  = useState(false)
  const [editingCell,   setEditingCell]   = useState<{ ri: number; ci: number } | null>(null)
  const [editValue,     setEditValue]     = useState('')
  const [ctxMenu,       setCtxMenu]       = useState<
    { x: number; y: number; kind: 'cell' | 'row' | 'col'; ri?: number; ci: number } | null
  >(null)
  const [toast,         setToast]         = useState<string | null>(null)
  const filterRef = useRef<HTMLInputElement>(null)
  const editInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setLoading(true)
    setError('')
    setSchema(null)
    setSelectedTable(null)
    setFilter('')
    setRevealedCells(new Set())
    setJsonRevealed(false)
    invoke<unknown>('db.read', { path: dbPath })
      .then(raw => {
        const s = raw as DBSchema
        setSchema(s)
        if (s.tables?.length) setSelectedTable(s.tables[0].name)
        setLoading(false)
      })
      .catch(e => { setError(String(e)); setLoading(false) })
  }, [dbPath])

  // Reset revealed state when table or filter changes, or privacy is re-enabled
  useEffect(() => {
    setRevealedCells(new Set())
    setJsonRevealed(false)
  }, [selectedTable, filter])

  useEffect(() => {
    if (privacyMode) {
      setRevealedCells(new Set())
      setJsonRevealed(false)
    }
  }, [privacyMode])

  const handleSelectTable = useCallback((name: string) => {
    setSelectedTable(name)
    setFilter('')
  }, [])

  const toggleCell = useCallback((key: string) => {
    setRevealedCells(prev => {
      const next = new Set(prev)
      if (next.has(key)) { next.delete(key) } else { next.add(key) }
      return next
    })
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4500)
    return () => clearTimeout(t)
  }, [toast])

  const table      = schema?.tables?.find(t => t.name === selectedTable) ?? null
  const tableCount = schema?.tables?.length ?? 0

  // Re-reads the schema without disturbing selection/filter state, used after
  // a write so the grid reflects the edit immediately.
  const reload = useCallback(() => {
    return invoke<unknown>('db.read', { path: dbPath }).then(raw => {
      setSchema(raw as DBSchema)
    })
  }, [dbPath])

  const runExec = useCallback(async (sql: string, params: any[]) => {
    try {
      await invoke('db.exec', { path: dbPath, sql, params })
      await reload()
    } catch (e) {
      setToast(String(e))
    }
  }, [dbPath, reload])

  const startEditCell = useCallback((ri: number, ci: number) => {
    if (!table) return
    const v = table.rows[ri]?.[ci]
    setEditValue(v === null || v === undefined ? '' : String(v))
    setEditingCell({ ri, ci })
  }, [table])

  const commitEditCell = useCallback(async () => {
    if (!table || !editingCell) return
    const { ri, ci } = editingCell
    const col = table.columns[ci]
    const where = rowWhere(table, ri)
    setEditingCell(null)
    if (!where) { setToast('Cannot locate this row to edit'); return }
    const sql = `UPDATE ${quoteIdent(table.name)} SET ${quoteIdent(col.name)} = ? WHERE ${where.clause}`
    await runExec(sql, [editValue, ...where.params])
  }, [table, editingCell, editValue, runExec])

  const clearCell = useCallback((ri: number, ci: number) => {
    if (!table) return
    const col = table.columns[ci]
    const where = rowWhere(table, ri)
    if (!where) { setToast('Cannot locate this row'); return }
    const sql = `UPDATE ${quoteIdent(table.name)} SET ${quoteIdent(col.name)} = NULL WHERE ${where.clause}`
    void runExec(sql, where.params)
  }, [table, runExec])

  const clearRow = useCallback((ri: number) => {
    if (!table) return
    const where = rowWhere(table, ri)
    if (!where) { setToast('Cannot locate this row'); return }
    const sets = table.columns.map(c => `${quoteIdent(c.name)} = NULL`).join(', ')
    const sql = `UPDATE ${quoteIdent(table.name)} SET ${sets} WHERE ${where.clause}`
    void runExec(sql, where.params)
  }, [table, runExec])

  const deleteRow = useCallback((ri: number) => {
    if (!table) return
    const where = rowWhere(table, ri)
    if (!where) { setToast('Cannot locate this row'); return }
    const sql = `DELETE FROM ${quoteIdent(table.name)} WHERE ${where.clause}`
    void runExec(sql, where.params)
  }, [table, runExec])

  const clearColumn = useCallback((ci: number) => {
    if (!table) return
    const col = table.columns[ci]
    const sql = `UPDATE ${quoteIdent(table.name)} SET ${quoteIdent(col.name)} = NULL`
    void runExec(sql, [])
  }, [table, runExec])

  const deleteColumn = useCallback((ci: number) => {
    if (!table) return
    const col = table.columns[ci]
    const sql = `ALTER TABLE ${quoteIdent(table.name)} DROP COLUMN ${quoteIdent(col.name)}`
    void runExec(sql, [])
  }, [table, runExec])

  // Holds original row indices (not the rows themselves) so cell edits can
  // still address the correct rowid/row data even while a filter is active.
  const filteredIndices = useMemo(() => {
    if (!table) return []
    const indices = table.rows.map((_, i) => i)
    if (!filter.trim()) return indices
    const q = filter.toLowerCase()
    return indices.filter(i =>
      table.rows[i].some(cell => cell !== null && cell !== undefined && String(cell).toLowerCase().includes(q)),
    )
  }, [table, filter])

  const filteredRows = useMemo(
    () => filteredIndices.map(i => table!.rows[i]),
    [filteredIndices, table],
  )

  const fileName = dbPath.replace(/\\/g, '/').split('/').pop() ?? dbPath

  const tableItems: PageSidebarNavItem[] = !loading && !error
    ? (schema?.tables ?? []).map(t => ({
        id: t.name,
        label: t.name,
        icon: <TableIcon />,
        meta: t.row_count.toLocaleString(),
      }))
    : []

  return (
    <div className="db-root">

      {/* ── Info bar ────────────────────────────────────────────────────────── */}
      <div className="db-infobar">
        <span className="db-infobar-icon"><DBIcon size={12} /></span>
        <span className="db-infobar-path" title={dbPath}>{fileName}</span>
        {!loading && !error && (
          <span className="db-infobar-meta">{tableCount} table{tableCount !== 1 ? 's' : ''}</span>
        )}
        {privacyMode && !loading && !error && (
          <span className="db-privacy-badge"><EyeOffIcon /> Privacy</span>
        )}
      </div>

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      <div className="db-body">

        {/* ── Left: table list ──────────────────────────────────────────────── */}
        <SidebarPanel
          title="Tables"
          items={tableItems}
          activeId={selectedTable}
          onSelect={handleSelectTable}
          emptyMessage="No tables"
        >
          {loading && <div className="px-2.5 py-2.5 text-[12px] text-[var(--info-bar-color)] opacity-50 italic">Loading…</div>}
          {error && (
            <div className="flex items-center gap-1.5 px-2.5 py-2.5 text-[12px] text-[var(--color-error)]">
              <WarningIcon /> {error}
            </div>
          )}
        </SidebarPanel>

        {/* ── Right: data panel ─────────────────────────────────────────────── */}
        <main className="db-main">

          {loading && (
            <div className="db-state-overlay">
              <div className="db-spinner" />
              <span>Reading database…</span>
            </div>
          )}

          {!loading && error && (
            <div className="db-state-overlay db-state-overlay--error">
              <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <circle cx="8" cy="8" r="6.5"/><path d="M8 5v3.5M8 10.5v.5"/>
              </svg>
              <span>{error}</span>
            </div>
          )}

          {!loading && !error && !table && tableCount > 0 && (
            <div className="db-state-overlay">
              <div className="db-empty-icon"><GridIcon /></div>
              <span className="db-empty-title">Select a table</span>
              <span className="db-empty-sub">{tableCount} table{tableCount !== 1 ? 's' : ''} available on the left</span>
            </div>
          )}

          {!loading && !error && tableCount === 0 && (
            <div className="db-state-overlay">
              <div className="db-empty-icon"><DBIcon size={22} /></div>
              <span className="db-empty-title">Empty database</span>
              <span className="db-empty-sub">No tables found in this file</span>
            </div>
          )}

          {!loading && !error && table && (
            <>
              {/* ── Toolbar ─────────────────────────────────────────────────── */}
              <div className="db-toolbar">
                <span className="db-toolbar-title">{table.name}</span>
                <span className="db-toolbar-meta">
                  {table.row_count.toLocaleString()} rows
                  {filteredRows.length !== table.rows.length && ` · ${filteredRows.length.toLocaleString()} shown`}
                  {table.rows.length < table.row_count && ` · capped at ${table.rows.length}`}
                  {'  ·  '}{table.columns.length} cols
                </span>

                <div className="db-filter-wrap">
                  <span className="db-filter-icon"><FilterIcon /></span>
                  <input
                    ref={filterRef}
                    className="db-filter-input"
                    placeholder="Filter rows…"
                    value={filter}
                    onChange={e => setFilter(e.target.value)}
                  />
                  {filter && (
                    <button className="db-filter-clear" onClick={() => setFilter('')} title="Clear">×</button>
                  )}
                </div>

                <div className="db-toolbar-spacer" />

                <div className="db-view-toggles">
                  <button
                    className={`db-view-btn${viewMode === 'table' ? ' is-active' : ''}`}
                    onClick={() => setViewMode('table')}
                    title="Table view"
                  ><GridIcon /></button>
                  <button
                    className={`db-view-btn${viewMode === 'json' ? ' is-active' : ''}`}
                    onClick={() => setViewMode('json')}
                    title="JSON view"
                  ><JsonIcon /></button>
                </div>
              </div>

              {/* ── Table grid ──────────────────────────────────────────────── */}
              {viewMode === 'table' && (
                <div className="db-table-wrap">
                  <table className="db-table">
                    <thead>
                      <tr>
                        <th className="db-rownum-th">#</th>
                        {table.columns.map((col, ci) => (
                          <th
                            key={col.name}
                            onContextMenu={e => {
                              e.preventDefault()
                              setCtxMenu({ x: e.clientX, y: e.clientY, kind: 'col', ci })
                            }}
                          >
                            <div className="db-col-header">
                              {col.pk && <span className="db-pk-badge">PK</span>}
                              <span className="db-col-name">{col.name}</span>
                              {col.type && <span className="db-col-type">{col.type.toUpperCase()}</span>}
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredIndices.map((ri, displayIdx) => {
                        const row = table.rows[ri]
                        return (
                        <tr key={ri}>
                          <td
                            className="db-rownum-td"
                            onContextMenu={e => {
                              e.preventDefault()
                              setCtxMenu({ x: e.clientX, y: e.clientY, kind: 'row', ri, ci: 0 })
                            }}
                          >{displayIdx + 1}</td>
                          {(row ?? []).map((cell, ci) => {
                            const isNull = cell === null || cell === undefined
                            const cellKey = `${ri}-${ci}`
                            const isRevealed = revealedCells.has(cellKey)
                            const shouldBlur = privacyMode && !isNull && !isRevealed
                            const isPrivacyCell = privacyMode && !isNull
                            const isEditing = editingCell?.ri === ri && editingCell?.ci === ci
                            if (isEditing) {
                              return (
                                <td key={ci} className="db-cell--editing">
                                  <input
                                    ref={editInputRef}
                                    autoFocus
                                    className="db-cell-input"
                                    value={editValue}
                                    onChange={e => setEditValue(e.target.value)}
                                    onBlur={() => commitEditCell()}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') { e.preventDefault(); void commitEditCell() }
                                      else if (e.key === 'Escape') { e.preventDefault(); setEditingCell(null) }
                                    }}
                                  />
                                </td>
                              )
                            }
                            return (
                              <td
                                key={ci}
                                className={isNull ? 'db-cell--null' : shouldBlur ? 'db-cell--blurred' : isPrivacyCell ? 'db-cell--revealed' : ''}
                                onClick={isPrivacyCell ? () => toggleCell(cellKey) : undefined}
                                onContextMenu={e => {
                                  e.preventDefault()
                                  setCtxMenu({ x: e.clientX, y: e.clientY, kind: 'cell', ri, ci })
                                }}
                                title={shouldBlur ? 'Click to reveal' : isPrivacyCell ? 'Click to hide' : undefined}
                              >
                                {isNull
                                  ? <span className="db-null">NULL</span>
                                  : shouldBlur
                                    ? <span className="db-cell-hidden">{String(cell)}</span>
                                    : String(cell)
                                }
                              </td>
                            )
                          })}
                        </tr>
                        )
                      })}
                      {filteredRows.length === 0 && (
                        <tr>
                          <td colSpan={table.columns.length + 1} className="db-cell--empty">
                            {filter ? `No rows match "${filter}"` : 'No rows'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {ctxMenu && (() => {
                const entries: ContextMenuEntry[] = []
                if (ctxMenu.kind === 'cell') {
                  entries.push(
                    { kind: 'item', label: 'Edit Cell', onClick: () => startEditCell(ctxMenu.ri!, ctxMenu.ci) },
                    { kind: 'item', label: 'Clear Cell', onClick: () => clearCell(ctxMenu.ri!, ctxMenu.ci) },
                    { kind: 'sep' },
                    { kind: 'item', label: 'Clear Row', onClick: () => clearRow(ctxMenu.ri!) },
                    { kind: 'item', label: 'Delete Row', danger: true, onClick: () => deleteRow(ctxMenu.ri!) },
                    { kind: 'sep' },
                    { kind: 'item', label: 'Clear Column', onClick: () => clearColumn(ctxMenu.ci) },
                    { kind: 'item', label: 'Delete Column', danger: true, onClick: () => deleteColumn(ctxMenu.ci) },
                  )
                } else if (ctxMenu.kind === 'row') {
                  entries.push(
                    { kind: 'item', label: 'Clear Row', onClick: () => clearRow(ctxMenu.ri!) },
                    { kind: 'item', label: 'Delete Row', danger: true, onClick: () => deleteRow(ctxMenu.ri!) },
                  )
                } else {
                  entries.push(
                    { kind: 'item', label: 'Clear Column', onClick: () => clearColumn(ctxMenu.ci) },
                    { kind: 'item', label: 'Delete Column', danger: true, onClick: () => deleteColumn(ctxMenu.ci) },
                  )
                }
                return (
                  <ContextMenu
                    x={ctxMenu.x}
                    y={ctxMenu.y}
                    entries={entries}
                    onClose={() => setCtxMenu(null)}
                  />
                )
              })()}

              {toast && (
                <div className="db-toast" onClick={() => setToast(null)}>
                  <WarningIcon /> {toast}
                </div>
              )}

              {/* ── JSON view ───────────────────────────────────────────────── */}
              {viewMode === 'json' && (
                <div className="db-json-wrap">
                  <JsonView
                    rows={filteredRows}
                    columns={table.columns}
                    privacyMode={privacyMode}
                    jsonRevealed={jsonRevealed}
                    onReveal={() => setJsonRevealed(true)}
                    onHide={() => setJsonRevealed(false)}
                  />
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  )
}
