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

// ── helpers ────────────────────────────────────────────────────────────────────

function relPath(cwd: string, file: string): string {
  const norm  = file.replace(/\\/g, '/')
  const base  = cwd.replace(/\\/g, '/').replace(/\/?$/, '/')
  if (norm.startsWith(base)) return norm.slice(base.length)
  // Fallback: show last 3 segments
  return norm.split('/').slice(-3).join('/')
}

/** Identify root-cause and cascade info for items in one file (sorted by line). */
function rootCauseLabel(groupItems: ProbItem[], idx: number): string | null {
  const errors = groupItems.filter(i => i.sev === 0)
  if (errors.length < 2) return null          // single error → no label needed

  const item = groupItems[idx]
  if (item.sev !== 0) return null             // only label errors

  if (item === errors[0]) return 'root cause' // first error = likely origin

  // Look for explicit back-reference in the message ("at line N")
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

  /** Group filtered items by file, each group sorted by line then col. */
  const groups = useMemo(() => {
    const map = new Map<string, ProbItem[]>()
    for (const item of filtered) {
      const arr = map.get(item.file) ?? []
      arr.push(item)
      map.set(item.file, arr)
    }
    return Array.from(map.entries())
      .map(([file, its]) => ({
        file,
        items: [...its].sort((a, b) => a.line - b.line || a.col - b.col),
      }))
  }, [filtered])

  const handleItemClick = useCallback((file: string, line: number, col: number) => {
    onOpenFile(file, line, col)
  }, [onOpenFile])

  // ── summary label ────────────────────────────────────────────────────────────
  let summaryEl: React.ReactNode
  if (scanning) {
    summaryEl = <span className="prob-count-dim">scanning…</span>
  } else if (items.length === 0) {
    summaryEl = <span className="prob-count-ok">✓ no problems</span>
  } else {
    summaryEl = (
      <>
        {errCount  > 0 && <span className="prob-count-err">{errCount} error{errCount  !== 1 ? 's' : ''}</span>}
        {warnCount > 0 && <span className="prob-count-warn">{warnCount} warning{warnCount !== 1 ? 's' : ''}</span>}
      </>
    )
  }

  return (
    <div className="prob-pane">

      {/* ── header ────────────────────────────────────────────────────────── */}
      <div className="prob-header">
        <span className="prob-title">⚠ Problems</span>
        {sources.length > 0 && (
          <span className="prob-sources">{sources.join(' · ')}</span>
        )}
        <div className="prob-spacer" />
        <div className="prob-summary">{summaryEl}</div>
        <button
          className={`prob-rescan${scanning ? ' spinning' : ''}`}
          onClick={() => onRescan(tabId, cwd)}
          disabled={scanning}
          title="Re-scan project"
        >
          ↺ Rescan
        </button>
      </div>

      {/* ── filter bar ────────────────────────────────────────────────────── */}
      <div className="prob-filters">
        {(['all', 'errors', 'warnings'] as Filter[]).map(f => {
          const count = f === 'all' ? items.length : f === 'errors' ? errCount : warnCount
          return (
            <button
              key={f}
              className={`prob-filter${filter === f ? ' active' : ''}`}
              onClick={() => setFilter(f)}
            >
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
            {items.length === 0
              ? '✓  No problems found in this project'
              : 'No problems match the current filter'}
          </div>
        )}

        {groups.map(({ file, items: gItems }) => {
          const hasErr = gItems.some(i => i.sev === 0)
          return (
            <div key={file} className="prob-group">

              {/* file header */}
              <div className="prob-file-header">
                <span className="prob-file-path" title={file}>{relPath(cwd, file)}</span>
                <span className={`prob-file-badge ${hasErr ? 'err' : 'warn'}`}>{gItems.length}</span>
              </div>

              {/* items */}
              <div className="prob-file-items">
                {gItems.map((item, idx) => {
                  const rcLabel = rootCauseLabel(gItems, idx)
                  const isRoot  = rcLabel === 'root cause'
                  const cascade = rcLabel && !isRoot ? rcLabel : null

                  return (
                    <div
                      key={idx}
                      className="prob-item"
                      onClick={() => handleItemClick(item.file, item.line, item.col)}
                      title={`${relPath(cwd, item.file)} · line ${item.line}`}
                    >
                      <div className="prob-item-row">
                        <span className={`prob-sev-dot ${item.sev === 0 ? 'err' : item.sev === 1 ? 'warn' : 'info'}`}>
                          {item.sev === 0 ? '●' : item.sev === 1 ? '◐' : '○'}
                        </span>
                        <span className="prob-pos">{item.line}:{item.col}</span>
                        {item.code && <span className="prob-code">{item.code}</span>}
                        <span className="prob-msg">{item.msg}</span>
                        {isRoot && <span className="prob-root-badge">root cause</span>}
                      </div>
                      {cascade && (
                        <div className="prob-cascade">↳ {cascade}</div>
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
          {errCount  > 0 && <span className="err">{errCount} error{errCount !== 1 ? 's' : ''}</span>}
          {errCount  > 0 && warnCount > 0 && <span className="sep">·</span>}
          {warnCount > 0 && <span className="warn">{warnCount} warning{warnCount !== 1 ? 's' : ''}</span>}
          <span className="sep">·</span>
          <span className="dim">{sources.join(', ')}</span>
        </div>
      )}

    </div>
  )
}
