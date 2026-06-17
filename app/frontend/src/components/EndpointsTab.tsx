import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { EndpointItem } from '../types'
import { ScanEndpoints } from '../../wailsjs/go/main/App'
import { Skeleton } from './Skeleton'
import SubNavTabs from './shared/SubNavTabs'
import { addBackgroundTask, removeBackgroundTask } from '../lib/backgroundTaskStore'
import './EndpointsTab.scss'

interface Props {
  cwd: string
  active: boolean
}

type SevFilter = 'all' | 'high' | 'medium' | 'info'

// ── Severity / method meta ──────────────────────────────────────────────────────

const SEV_META: Record<EndpointItem['severity'], { label: string; color: string; bg: string }> = {
  high:   { label: 'No Auth',     color: 'var(--color-error)',   bg: 'var(--color-error-bg)' },
  medium: { label: 'No Throttle', color: 'var(--color-warning)', bg: 'var(--color-warning-bg)' },
  info:   { label: 'Secured',     color: 'var(--color-success)', bg: 'var(--color-success-bg)' },
}

const METHOD_COLORS: Record<string, string> = {
  GET: 'var(--color-accent)', POST: 'var(--color-success)', PUT: 'var(--color-warning)', PATCH: 'var(--color-warning)',
  DELETE: 'var(--color-error)', ANY: '#8e8e93',
}

// ── Icons ─────────────────────────────────────────────────────────────────────

const IconCheck = () => (
  <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
    <circle cx="7" cy="7" r="6.5" fill="currentColor" fillOpacity="0.1" stroke="currentColor" strokeWidth="1.2"/>
    <path d="M4 7L6 9.2L10 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const IconWarning = () => (
  <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
    <path d="M7 1.8L12.4 11.5H1.6L7 1.8Z" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
    <path d="M7 5.5V8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    <circle cx="7" cy="10.2" r="0.7" fill="currentColor"/>
  </svg>
)

const IconRefresh = ({ spinning }: { spinning: boolean }) => (
  <svg
    width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden
    style={{ animation: spinning ? 'endpoints-spin 0.9s linear infinite' : undefined, flexShrink: 0 }}
  >
    <path d="M11 6.5C11 9.04 8.76 11 6 11C3.24 11 1 9.04 1 6.5C1 3.96 3.24 2 6 2C7.6 2 9.02 2.72 9.9 3.86" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    <path d="M10 1.5V4.5H7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const IconShield = () => (
  <svg width="28" height="28" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path d="M8 2L3 4.5V8c0 3 2.5 5 5 6 2.5-1 5-3 5-6V4.5L8 2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
    <path d="M5.5 8l2 2 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const IconChevron = ({ open }: { open: boolean }) => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden
    style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform var(--t-fast)' }}>
    <path d="M3 1.5L7 5L3 8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

// ── Helpers ───────────────────────────────────────────────────────────────────

function splitPath(cwd: string, file: string): { dir: string; name: string } {
  const norm = file.replace(/\\/g, '/')
  const base = cwd.replace(/\\/g, '/').replace(/\/?$/, '/')
  const rel  = norm.startsWith(base) ? norm.slice(base.length) : norm.split('/').slice(-3).join('/')
  const sep  = rel.lastIndexOf('/')
  return sep === -1 ? { dir: '', name: rel } : { dir: rel.slice(0, sep + 1), name: rel.slice(sep + 1) }
}

function itemKey(item: EndpointItem): string {
  return `${item.file.replace(/\\/g, '/')}::${item.line}::${item.method}::${item.path}`
}

function severitySort(a: EndpointItem, b: EndpointItem) {
  const order = { high: 0, medium: 1, info: 2 }
  return order[a.severity] - order[b.severity]
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function EndpointsSkeleton() {
  return (
    <div className="endpoints__skeleton">
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="endpoints__skeleton-row">
          <Skeleton width={50} height={16} radius="var(--r-sm)" />
          <Skeleton width={140} height={12} />
          <Skeleton width={90} height={18} radius="var(--r-xl)" />
          <Skeleton width={120} height={12} />
        </div>
      ))}
      <div className="endpoints__skeleton-label">Scanning workspace for endpoints…</div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function EndpointsTab({ cwd, active }: Props) {
  const [items, setItems] = useState<EndpointItem[]>([])
  const [scanning, setScanning] = useState(false)
  const [sevFilter, setSevFilter] = useState<SevFilter>('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  const hasScanned = useRef(false)

  const runScan = useCallback(() => {
    if (!cwd) return
    setScanning(true)
    setExpanded(null)
    const taskId = addBackgroundTask('Scanning endpoints…')
    ScanEndpoints(cwd)
      .then(r => setItems(Array.isArray(r) ? r as EndpointItem[] : []))
      .catch(() => setItems([]))
      .finally(() => {
        setScanning(false)
        removeBackgroundTask(taskId)
      })
  }, [cwd])

  useEffect(() => {
    hasScanned.current = false
    setItems([])
  }, [cwd])

  useEffect(() => {
    if (active && cwd && !hasScanned.current) {
      hasScanned.current = true
      runScan()
    }
  }, [active, cwd, runScan])

  const sorted = useMemo(() => [...items].sort(severitySort), [items])

  const counts = useMemo(() => {
    const c: Record<SevFilter, number> = { all: sorted.length, high: 0, medium: 0, info: 0 }
    for (const i of sorted) c[i.severity]++
    return c
  }, [sorted])

  const filtered = useMemo(
    () => sevFilter === 'all' ? sorted : sorted.filter(i => i.severity === sevFilter),
    [sorted, sevFilter]
  )

  return (
    <div className="endpoints">
      <div className={`flex items-stretch border-b border-sep shrink-0${scanning ? ' opacity-60 pointer-events-none' : ''}`}>
        <SubNavTabs
          size="compact"
          items={[
            { id: 'all', label: 'All', count: !scanning ? counts.all : undefined },
            ...(!scanning
              ? (['high', 'medium', 'info'] as const)
                  .filter(sev => counts[sev] > 0 || sevFilter === sev)
                  .map(sev => ({
                    id: sev,
                    label: SEV_META[sev].label,
                    icon: <span style={{ color: SEV_META[sev].color, display: 'flex', alignItems: 'center' }}><svg width="7" height="7" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3.5" fill="currentColor"/></svg></span>,
                    count: counts[sev],
                  }))
              : []
            ),
          ]}
          activeId={sevFilter}
          onSelect={id => setSevFilter(id as SevFilter)}
        />
        <div className="ml-auto flex items-center gap-2.5 px-3 shrink-0">
          {scanning ? (
            <span className="endpoints__status-dim">Analyzing…</span>
          ) : items.length > 0 ? (
            <span className="endpoints__status-dim">{items.length} endpoint{items.length !== 1 ? 's' : ''}</span>
          ) : null}
          <button className="endpoints__analyze-btn" onClick={runScan} disabled={scanning}>
            <IconRefresh spinning={scanning} />
            Analyze
          </button>
        </div>
      </div>

      {scanning ? (
        <EndpointsSkeleton />
      ) : filtered.length === 0 ? (
        <div className="endpoints__empty">
          <span className="endpoints__empty-icon"><IconShield /></span>
          <span className="endpoints__empty-title">
            {items.length === 0 ? 'No endpoints found' : 'No endpoints match filter'}
          </span>
          <span className="endpoints__empty-sub">
            {items.length === 0
              ? 'Run Analyze to scan this workspace for API route definitions and their security posture'
              : 'Try a different severity filter above'}
          </span>
        </div>
      ) : (
        <div className="endpoints__table-wrap">
          <table className="endpoints__table">
            <thead>
              <tr>
                <th className="endpoints__th">Method</th>
                <th className="endpoints__th">Path</th>
                <th className="endpoints__th">Security</th>
                <th className="endpoints__th">File</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(item => {
                const k = itemKey(item)
                const isOpen = expanded === k
                const { dir, name } = splitPath(cwd, item.file)
                const sev = SEV_META[item.severity]
                const methodColor = METHOD_COLORS[item.method] ?? METHOD_COLORS.ANY
                return (
                  <React.Fragment key={k}>
                    <tr className="endpoints__row" onClick={() => setExpanded(isOpen ? null : k)}>
                      <td className="endpoints__cell-chevron"><IconChevron open={isOpen} /></td>
                      <td className="endpoints__method">
                        <span className="endpoints__method-badge" style={{ color: methodColor, borderColor: methodColor }}>
                          {item.method}
                        </span>
                      </td>
                      <td className="endpoints__path" title={item.path}>{item.path}</td>
                      <td className="endpoints__security">
                        <span className="endpoints__sev-badge" style={{ color: sev.color, background: sev.bg }}>{sev.label}</span>
                        <span className={`endpoints__chip${item.has_rate_limit ? ' ok' : ' bad'}`} title="Rate limiting / throttling">
                          {item.has_rate_limit ? <IconCheck /> : <IconWarning />} Throttle
                        </span>
                        <span className={`endpoints__chip${item.has_auth ? ' ok' : ' bad'}`} title="Authentication / permission check">
                          {item.has_auth ? <IconCheck /> : <IconWarning />} Auth
                        </span>
                      </td>
                      <td className="endpoints__file" title={item.file}>
                        {dir && <span className="endpoints__file-dir">{dir}</span>}
                        <span className="endpoints__file-name">{name}</span>
                        <span className="endpoints__file-line">:{item.line}</span>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="endpoints__detail-row">
                        <td colSpan={4}>
                          <div className="endpoints__detail">
                            <div className="endpoints__detail-meta">
                              <span className="endpoints__detail-framework">{item.framework}</span>
                              <span className="endpoints__detail-sep">·</span>
                              <span>{dir}{name}:{item.line}</span>
                            </div>
                            <pre className="endpoints__snippet">{item.snippet}</pre>
                            <div className="endpoints__checks">
                              <div className={`endpoints__check${item.has_rate_limit ? ' ok' : ' bad'}`}>
                                {item.has_rate_limit ? <IconCheck /> : <IconWarning />}
                                <div>
                                  <div className="endpoints__check-title">
                                    {item.has_rate_limit ? 'Rate limiting detected' : 'No rate limiting detected'}
                                  </div>
                                  <div className="endpoints__check-sub">
                                    {item.has_rate_limit
                                      ? `Matched: ${item.rate_limit_evidence}`
                                      : 'Add throttling middleware (e.g. express-rate-limit, Flask-Limiter, slowapi, bucket4j) to protect this route from abuse.'}
                                  </div>
                                </div>
                              </div>
                              <div className={`endpoints__check${item.has_auth ? ' ok' : ' bad'}`}>
                                {item.has_auth ? <IconCheck /> : <IconWarning />}
                                <div>
                                  <div className="endpoints__check-title">
                                    {item.has_auth ? 'Auth / permission check detected' : 'No auth / permission check detected'}
                                  </div>
                                  <div className="endpoints__check-sub">
                                    {item.has_auth
                                      ? `Matched: ${item.auth_evidence}`
                                      : 'If this endpoint is not intentionally public, add an authentication or permission check (middleware, decorator, or guard).'}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {!scanning && items.length > 0 && (
        <div className="endpoints__disclaimer">
          <IconWarning />
          Static pattern matching: endpoints and security controls may be missed or misclassified. Verify findings manually, especially for endpoints intentionally left public.
        </div>
      )}
    </div>
  )
}
