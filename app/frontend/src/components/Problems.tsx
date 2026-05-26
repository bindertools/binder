import React, { useState, useMemo, useCallback } from 'react'
import { ProbItem } from '../types'
import './Problems.scss'

type Filter = 'all' | 'errors' | 'warnings'

interface Props {
  tabId:    string
  cwd:      string
  sources:  string[]
  items:    ProbItem[]
  scanning: boolean
  onRescan:    (tabId: string, cwd: string) => void
  onOpenFile:  (path: string, line: number, col: number) => void
}

// ── SVG Icons ──────────────────────────────────────────────────────────────────

const IconError = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
    <circle cx="7" cy="7" r="6.5" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="1.2"/>
    <path d="M4.8 4.8L9.2 9.2M9.2 4.8L4.8 9.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
  </svg>
)

const IconWarning = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
    <path d="M7 1.8L12.4 11.5H1.6L7 1.8Z" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
    <path d="M7 5.5V8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    <circle cx="7" cy="10.2" r="0.7" fill="currentColor"/>
  </svg>
)

const IconInfo = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
    <circle cx="7" cy="7" r="6.5" fill="currentColor" fillOpacity="0.1" stroke="currentColor" strokeWidth="1.2"/>
    <path d="M7 6.5V10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    <circle cx="7" cy="4.5" r="0.75" fill="currentColor"/>
  </svg>
)

const IconCheck = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
    <circle cx="7" cy="7" r="6.5" fill="currentColor" fillOpacity="0.1" stroke="currentColor" strokeWidth="1.2"/>
    <path d="M4 7L6 9.2L10 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const IconRefresh = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
    <path d="M11 6.5C11 9.04 8.76 11 6 11C3.24 11 1 9.04 1 6.5C1 3.96 3.24 2 6 2C7.6 2 9.02 2.72 9.9 3.86" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    <path d="M10 1.5V4.5H7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const IconFile = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
    <path d="M2.5 1H7L10 4V10.5C10 10.78 9.78 11 9.5 11H2.5C2.22 11 2 10.78 2 10.5V1.5C2 1.22 2.22 1 2.5 1Z" fill="currentColor" fillOpacity="0.12" stroke="currentColor" strokeWidth="1"/>
    <path d="M7 1V4.5H10" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
  </svg>
)

const IconGoto = () => (
  <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
    <path d="M2 9L9 2M9 2H5.5M9 2V5.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const IconProblems = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
    <path d="M6.5 1.2L12.2 11.5H0.8L6.5 1.2Z" fill="currentColor" fillOpacity="0.12" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
    <path d="M6.5 5V8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <circle cx="6.5" cy="10" r="0.7" fill="currentColor"/>
  </svg>
)

// ── helpers ────────────────────────────────────────────────────────────────────

function splitPath(cwd: string, file: string): { dir: string; name: string } {
  const norm = file.replace(/\\/g, '/')
  const base = cwd.replace(/\\/g, '/').replace(/\/?$/, '/')
  const rel  = norm.startsWith(base)
    ? norm.slice(base.length)
    : norm.split('/').slice(-3).join('/')
  const sep = rel.lastIndexOf('/')
  return sep === -1
    ? { dir: '', name: rel }
    : { dir: rel.slice(0, sep + 1), name: rel.slice(sep + 1) }
}

function rootCauseLabel(groupItems: ProbItem[], idx: number): string | null {
  const errors = groupItems.filter(i => i.sev === 0)
  if (errors.length < 2) return null
  const item = groupItems[idx]
  if (item.sev !== 0) return null
  if (item === errors[0]) return 'root cause'
  const ref = item.msg.match(/at line (\d+)/)
  if (ref) return `cascades from line ${ref[1]}`
  return `may cascade from line ${errors[0].line}`
}

// ── component ──────────────────────────────────────────────────────────────────

export default function Problems({ tabId, cwd, sources, items, scanning, onRescan, onOpenFile }: Props) {
  const [filter, setFilter] = useState<Filter>('all')

  const errCount  = useMemo(() => items.filter(i => i.sev === 0).length, [items])
  const warnCount = useMemo(() => items.filter(i => i.sev === 1).length, [items])

  const filtered = useMemo(() => {
    if (filter === 'errors')   return items.filter(i => i.sev === 0)
    if (filter === 'warnings') return items.filter(i => i.sev === 1)
    return items
  }, [items, filter])

  const groups = useMemo(() => {
    const map = new Map<string, ProbItem[]>()
    for (const item of filtered) {
      const arr = map.get(item.file) ?? []
      arr.push(item)
      map.set(item.file, arr)
    }
    return Array.from(map.entries()).map(([file, its]) => ({
      file,
      items: [...its].sort((a, b) => a.line - b.line || a.col - b.col),
    }))
  }, [filtered])

  const handleItemClick = useCallback((file: string, line: number, col: number) => {
    onOpenFile(file, line, col)
  }, [onOpenFile])

  return (
    <div className="prob-pane">

      {/* ── header ────────────────────────────────────────────────────────── */}
      <div className="prob-header">
        <span className="prob-header-icon"><IconProblems /></span>
        <span className="prob-title">Problems</span>
        {sources.length > 0 && (
          <span className="prob-sources">{sources.join(' · ')}</span>
        )}
        <div className="prob-spacer" />

        <div className="prob-summary">
          {scanning ? (
            <span className="prob-count-dim">scanning…</span>
          ) : items.length === 0 ? (
            <span className="prob-count-ok">
              <span className="prob-count-icon"><IconCheck /></span>
              No problems
            </span>
          ) : (
            <>
              {errCount > 0 && (
                <span className="prob-count-err">
                  <span className="prob-count-icon"><IconError /></span>
                  {errCount} error{errCount !== 1 ? 's' : ''}
                </span>
              )}
              {warnCount > 0 && (
                <span className="prob-count-warn">
                  <span className="prob-count-icon"><IconWarning /></span>
                  {warnCount} warning{warnCount !== 1 ? 's' : ''}
                </span>
              )}
            </>
          )}
        </div>

        <button
          className={`prob-rescan${scanning ? ' scanning' : ''}`}
          onClick={() => onRescan(tabId, cwd)}
          disabled={scanning}
          title="Re-scan project"
        >
          <span className="prob-rescan-icon"><IconRefresh /></span>
          Rescan
        </button>
      </div>

      {/* ── filter bar ────────────────────────────────────────────────────── */}
      <div className="prob-filters">
        {(['all', 'errors', 'warnings'] as Filter[]).map(f => {
          const count = f === 'all' ? items.length : f === 'errors' ? errCount : warnCount
          return (
            <button
              key={f}
              className={`prob-filter${filter === f ? ' active' : ''} ${f}`}
              onClick={() => setFilter(f)}
            >
              {f === 'errors'   && <span className="prob-filter-icon err"><IconError /></span>}
              {f === 'warnings' && <span className="prob-filter-icon warn"><IconWarning /></span>}
              {f.charAt(0).toUpperCase() + f.slice(1)}
              <span className="prob-filter-count">{count}</span>
            </button>
          )
        })}
        <span className="prob-cwd" title={cwd}>
          {cwd.replace(/\\/g, '/').split('/').slice(-2).join('/')}
        </span>
      </div>

      {/* ── body ──────────────────────────────────────────────────────────── */}
      <div className="prob-body">

        {groups.length === 0 && !scanning && (
          <div className="prob-empty">
            <span className={`prob-empty-icon ${items.length === 0 ? 'ok' : 'info'}`}>
              {items.length === 0 ? <IconCheck /> : <IconInfo />}
            </span>
            <span>
              {items.length === 0
                ? 'No problems found in this project'
                : 'No problems match the current filter'}
            </span>
          </div>
        )}

        {groups.map(({ file, items: gItems }) => {
          const { dir, name } = splitPath(cwd, file)
          const gErrCount  = gItems.filter(i => i.sev === 0).length
          const gWarnCount = gItems.filter(i => i.sev === 1).length

          return (
            <div key={file} className="prob-group">

              {/* file header */}
              <div className="prob-file-header">
                <span className="prob-file-icon"><IconFile /></span>
                <span className="prob-file-path" title={file}>
                  {dir && <span className="prob-file-dir">{dir}</span>}
                  <span className="prob-file-name">{name}</span>
                </span>
                <div className="prob-file-counts">
                  {gErrCount  > 0 && (
                    <span className="prob-file-badge err">
                      <IconError />{gErrCount}
                    </span>
                  )}
                  {gWarnCount > 0 && (
                    <span className="prob-file-badge warn">
                      <IconWarning />{gWarnCount}
                    </span>
                  )}
                </div>
              </div>

              {/* items */}
              <div className="prob-file-items">
                {gItems.map((item, idx) => {
                  const rcLabel  = rootCauseLabel(gItems, idx)
                  const isRoot   = rcLabel === 'root cause'
                  const cascade  = rcLabel && !isRoot ? rcLabel : null
                  const sevClass = item.sev === 0 ? 'err' : item.sev === 1 ? 'warn' : 'info'

                  return (
                    <div
                      key={idx}
                      className={`prob-item ${sevClass}`}
                      onClick={() => handleItemClick(item.file, item.line, item.col)}
                      title={`Open ${name} — line ${item.line}, col ${item.col}`}
                    >
                      <div className="prob-item-row">
                        <span className={`prob-sev-icon ${sevClass}`}>
                          {item.sev === 0 ? <IconError /> : item.sev === 1 ? <IconWarning /> : <IconInfo />}
                        </span>
                        <span className="prob-location">
                          <span className="prob-location-label">Ln</span>
                          {item.line}
                          <span className="prob-location-sep">,</span>
                          <span className="prob-location-label">Col</span>
                          {item.col}
                        </span>
                        {item.code && <span className="prob-code">{item.code}</span>}
                        <span className="prob-msg">{item.msg}</span>
                        <div className="prob-item-end">
                          {isRoot && <span className="prob-root-badge">root cause</span>}
                          <span className="prob-goto" aria-label="Go to location">
                            <IconGoto />
                          </span>
                        </div>
                      </div>
                      {cascade && (
                        <div className="prob-cascade">
                          <span className="prob-cascade-indent" />
                          {cascade}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {/* ── footer ────────────────────────────────────────────────────────── */}
      {items.length > 0 && (
        <div className="prob-footer">
          {errCount > 0 && (
            <span className="err">
              <span className="prob-footer-icon"><IconError /></span>
              {errCount} error{errCount !== 1 ? 's' : ''}
            </span>
          )}
          {errCount > 0 && warnCount > 0 && <span className="sep">·</span>}
          {warnCount > 0 && (
            <span className="warn">
              <span className="prob-footer-icon"><IconWarning /></span>
              {warnCount} warning{warnCount !== 1 ? 's' : ''}
            </span>
          )}
          {sources.length > 0 && (
            <>
              <span className="sep">·</span>
              <span className="dim">{sources.join(', ')}</span>
            </>
          )}
        </div>
      )}

    </div>
  )
}
