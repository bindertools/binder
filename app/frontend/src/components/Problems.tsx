import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { ProbItem } from '../types'
import SubNavTabs from './shared/SubNavTabs'
import SidebarPanel from './shared/SidebarPanel'
import './Problems.scss'

// ── Types ─────────────────────────────────────────────────────────────────────

type DiagFilter = 'all' | 'errors' | 'warnings'
type MainTab    = 'diagnostics' | 'cwe'

export interface CweItem {
  cwe_id:            string
  name:              string
  description:       string
  severity:          'critical' | 'high' | 'medium' | 'low' | 'info'
  file:              string
  line:              number
  col:               number
  snippet:           string
  snippet_match_idx?: number
  mitre_url:         string
  remediation?:      string
}

interface Props {
  tabId:        string
  cwd:          string
  sources:      string[]
  items:        ProbItem[]
  scanning:     boolean
  cweItems?:    CweItem[]
  cweScanning?: boolean
  onRescan:     (tabId: string, cwd: string) => void
  onOpenFile:   (path: string, line: number, col: number) => void
  onCweScan?:   (cwd: string) => void
}

// ── Severity config ───────────────────────────────────────────────────────────

const SEV_META = {
  critical: { label: 'Critical', color: 'var(--color-severity-critical)', bg: 'rgba(255,69,58,0.12)',  order: 0 },
  high:     { label: 'High',     color: 'var(--color-severity-high)',     bg: 'rgba(255,107,53,0.12)', order: 1 },
  medium:   { label: 'Medium',   color: 'var(--color-severity-medium)',   bg: 'rgba(255,168,0,0.12)',  order: 2 },
  low:      { label: 'Low',      color: 'var(--color-severity-low)',      bg: 'rgba(52,199,89,0.10)',  order: 3 },
  info:     { label: 'Info',     color: 'var(--color-severity-info)',     bg: 'rgba(99,99,102,0.12)',  order: 4 },
} as const

// ── Dismissal persistence ─────────────────────────────────────────────────────

const DISMISSED_KEY = 'cmdide_cwe_dismissed'

function cweKey(item: CweItem): string {
  return `${item.cwe_id}::${item.file.replace(/\\/g, '/')}::${item.line}`
}

function loadDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch { return new Set() }
}

function saveDismissed(s: Set<string>): void {
  try { localStorage.setItem(DISMISSED_KEY, JSON.stringify([...s])) } catch { /* ignore */ }
}

// ── SVG Icons ─────────────────────────────────────────────────────────────────

const IconError = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
    <circle cx="7" cy="7" r="6.5" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="1.2"/>
    <path d="M4.8 4.8L9.2 9.2M9.2 4.8L4.8 9.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
  </svg>
)

const IconWarning = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
    <path d="M7 1.8L12.4 11.5H1.6L7 1.8Z" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
    <path d="M7 5.5V8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    <circle cx="7" cy="10.2" r="0.7" fill="currentColor"/>
  </svg>
)

const IconInfo = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
    <circle cx="7" cy="7" r="6.5" fill="currentColor" fillOpacity="0.1" stroke="currentColor" strokeWidth="1.2"/>
    <path d="M7 6.5V10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    <circle cx="7" cy="4.5" r="0.75" fill="currentColor"/>
  </svg>
)

const IconCheck = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
    <circle cx="7" cy="7" r="6.5" fill="currentColor" fillOpacity="0.1" stroke="currentColor" strokeWidth="1.2"/>
    <path d="M4 7L6 9.2L10 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const IconRefresh = ({ spinning }: { spinning: boolean }) => (
  <svg
    width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden
    style={{ animation: spinning ? 'prob-spin 0.9s linear infinite' : undefined, flexShrink: 0 }}
  >
    <path d="M11 6.5C11 9.04 8.76 11 6 11C3.24 11 1 9.04 1 6.5C1 3.96 3.24 2 6 2C7.6 2 9.02 2.72 9.9 3.86" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    <path d="M10 1.5V4.5H7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const IconFile = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
    <path d="M2.5 1H7L10 4V10.5C10 10.78 9.78 11 9.5 11H2.5C2.22 11 2 10.78 2 10.5V1.5C2 1.22 2.22 1 2.5 1Z" fill="currentColor" fillOpacity="0.12" stroke="currentColor" strokeWidth="1"/>
    <path d="M7 1V4.5H10" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
  </svg>
)

const IconGoto = () => (
  <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
    <path d="M2 9L9 2M9 2H5.5M9 2V5.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const IconShield = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path d="M8 2L3 4.5V8c0 3 2.5 5 5 6 2.5-1 5-3 5-6V4.5L8 2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
    <path d="M5.5 8l2 2 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const IconExternalLink = () => (
  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
    <path d="M2 10L10 2M10 2H6.5M10 2V5.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const IconFolder = () => (
  <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden>
    <path d="M1 4.5A1.5 1.5 0 012.5 3h3.086a1.5 1.5 0 011.06.44l.915.914A1.5 1.5 0 008.62 4.5H11.5A1.5 1.5 0 0113 6v5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 011 11V4.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
  </svg>
)

const IconDismiss = () => (
  <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden>
    <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
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

function cweSeveritySort(a: CweItem, b: CweItem) {
  return SEV_META[a.severity].order - SEV_META[b.severity].order
}

// ── Skeleton components ───────────────────────────────────────────────────────

const LIST_SKEL = [
  { id: 58, name: 82, file: 50 },
  { id: 65, name: 70, file: 38 },
  { id: 52, name: 90, file: 62 },
  { id: 70, name: 75, file: 45 },
  { id: 60, name: 85, file: 55 },
  { id: 55, name: 78, file: 42 },
  { id: 68, name: 68, file: 58 },
]

function CweListSkeleton() {
  return (
    <div className="prob-cwe-list-skeleton">
      {LIST_SKEL.map((w, i) => (
        <div key={i} className="prob-cwe-list-skel-row" style={{ animationDelay: `${i * 60}ms` }}>
          <div className="prob-skel-dot" />
          <div className="prob-cwe-list-skel-body">
            <div className="prob-skel-line" style={{ width: `${w.id}%`, height: 11 }} />
            <div className="prob-skel-line" style={{ width: `${w.name}%`, height: 12, marginTop: 4 }} />
            <div className="prob-skel-line" style={{ width: `${w.file}%`, height: 10, marginTop: 4 }} />
          </div>
        </div>
      ))}
      <div className="prob-cwe-list-skel-label">
        <span>Analyzing workspace…</span>
      </div>
    </div>
  )
}

function CweDetailSkeleton() {
  return (
    <div className="prob-cwe-detail-skeleton">
      {/* Header */}
      <div className="prob-cwe-detail-skel-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="prob-skel-line" style={{ width: 80, height: 22 }} />
          <div className="prob-skel-line" style={{ width: 58, height: 20, borderRadius: 4 }} />
        </div>
        <div className="prob-skel-line" style={{ width: '70%', height: 14, marginTop: 10 }} />
      </div>

      {/* About section */}
      <div className="prob-cwe-detail-skel-section">
        <div className="prob-skel-line" style={{ width: 130, height: 10, marginBottom: 10 }} />
        <div className="prob-skel-line" style={{ width: '100%', height: 12, marginBottom: 6 }} />
        <div className="prob-skel-line" style={{ width: '88%',  height: 12, marginBottom: 6 }} />
        <div className="prob-skel-line" style={{ width: '72%',  height: 12 }} />
      </div>

      {/* Location section */}
      <div className="prob-cwe-detail-skel-section">
        <div className="prob-skel-line" style={{ width: 80, height: 10, marginBottom: 10 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="prob-skel-line" style={{ width: '60%', height: 13 }} />
          <div className="prob-skel-line" style={{ width: 72, height: 28, borderRadius: 6, marginLeft: 'auto' }} />
        </div>
        <div className="prob-skel-line" style={{ width: 120, height: 11, marginTop: 6 }} />
      </div>

      {/* Code section */}
      <div className="prob-cwe-detail-skel-section">
        <div className="prob-skel-line" style={{ width: 50, height: 10, marginBottom: 10 }} />
        <div className="prob-skel-code">
          <div className="prob-skel-line" style={{ width: '75%', height: 12 }} />
        </div>
      </div>

      <div className="prob-cwe-detail-skel-footer">
        <div className="prob-skel-pulse-label">Loading finding details…</div>
      </div>
    </div>
  )
}

// ── CWE sub-components ────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: CweItem['severity'] }) {
  const m = SEV_META[severity]
  return (
    <span
      className="inline-flex items-center px-[7px] py-[2px] rounded-[4px] text-[10px] font-semibold uppercase tracking-[0.06em] whitespace-nowrap"
      style={{ color: m.color, background: m.bg }}
    >
      {m.label}
    </span>
  )
}

interface ListRowProps {
  item:      CweItem
  cwd:       string
  selected:  boolean
  onSelect:  () => void
  onDismiss: () => void
}

function CweListRow({ item, cwd, selected, onSelect, onDismiss }: ListRowProps) {
  const { name: fileName } = splitPath(cwd, item.file)
  const m = SEV_META[item.severity]

  return (
    <div
      className={`prob-cwe-list-row${selected ? ' selected' : ''}`}
      style={{ '--sev-color': m.color } as React.CSSProperties}
      onClick={onSelect}
      title={`${item.cwe_id}: ${item.name}`}
    >
      <span className="prob-cwe-list-dot" style={{ background: m.color }} />

      <div className="prob-cwe-list-body">
        <div className="prob-cwe-list-id-line">
          <span className="prob-cwe-list-id" style={{ color: m.color }}>{item.cwe_id}</span>
          <span className="prob-cwe-list-sev">{m.label}</span>
        </div>
        <div className="prob-cwe-list-name">{item.name}</div>
        <div className="prob-cwe-list-loc">
          <span className="prob-cwe-list-filename">{fileName}</span>
          <span className="prob-cwe-list-lineno">:{item.line}</span>
        </div>
      </div>

      <button
        className="prob-cwe-list-dismiss"
        onClick={e => { e.stopPropagation(); onDismiss() }}
        title="Dismiss this finding"
        aria-label="Dismiss finding"
      >
        <IconDismiss />
      </button>
    </div>
  )
}

interface DetailProps {
  item:      CweItem
  cwd:       string
  onOpen:    () => void
  onDismiss: () => void
}

function CweDetailView({ item, cwd, onOpen, onDismiss }: DetailProps) {
  const { dir, name: fileName } = splitPath(cwd, item.file)
  const m = SEV_META[item.severity]

  return (
    <div className="prob-cwe-detail-view">

      {/* ── Header ────────────────────────────────────────────────────────────── */}
      <div className="prob-cwe-detail-header" style={{ borderLeftColor: m.color }}>
        <div className="prob-cwe-detail-header-top">
          <div className="prob-cwe-detail-id-row">
            <a
              href={item.mitre_url}
              target="_blank"
              rel="noopener noreferrer"
              className="prob-cwe-detail-id-link"
              title={`Open ${item.cwe_id} on MITRE`}
              onClick={e => e.stopPropagation()}
            >
              <span className="prob-cwe-detail-id" style={{ color: m.color }}>{item.cwe_id}</span>
              <IconExternalLink />
            </a>
            <SeverityBadge severity={item.severity} />
          </div>
          <button
            className="prob-cwe-detail-dismiss-btn"
            onClick={onDismiss}
            title="Dismiss this finding locally"
          >
            <IconDismiss />
            Dismiss
          </button>
        </div>
        <div className="prob-cwe-detail-name">{item.name}</div>
      </div>

      {/* ── About ─────────────────────────────────────────────────────────────── */}
      <div className="prob-cwe-detail-section">
        <div className="prob-cwe-detail-section-label">About this weakness</div>
        <p className="prob-cwe-detail-desc">{item.description}</p>
      </div>

      {/* ── Impact ────────────────────────────────────────────────────────────── */}
      <div className="prob-cwe-detail-section">
        <div className="prob-cwe-detail-section-label">Impact</div>
        <div className="prob-cwe-impact">
          {item.cwe_id === 'CWE-78'  && 'Network / Local: attacker can execute arbitrary OS commands'}
          {item.cwe_id === 'CWE-79'  && "Network: attacker can inject and execute scripts in victim's browser"}
          {item.cwe_id === 'CWE-89'  && 'Network: attacker can read, modify, or delete database records'}
          {item.cwe_id === 'CWE-120' && 'Local / Network: memory corruption may lead to arbitrary code execution'}
          {item.cwe_id === 'CWE-134' && 'Network: format string exploitation can overwrite stack memory'}
          {item.cwe_id === 'CWE-95'  && 'Network: arbitrary JavaScript execution in the application context'}
          {item.cwe_id === 'CWE-502' && 'Network: deserialization of attacker-controlled data can execute arbitrary code'}
          {!['CWE-78','CWE-79','CWE-89','CWE-120','CWE-134','CWE-95','CWE-502'].includes(item.cwe_id) && 'Variable: see MITRE reference for full impact details'}
        </div>
      </div>

      {/* ── Location ──────────────────────────────────────────────────────────── */}
      <div className="prob-cwe-detail-section">
        <div className="prob-cwe-detail-section-label">Location</div>
        <div className="prob-cwe-detail-location">
          <div className="prob-cwe-detail-location-file">
            <span className="prob-cwe-detail-loc-icon"><IconFile /></span>
            <span className="prob-cwe-detail-loc-dir">{dir}</span>
            <span className="prob-cwe-detail-loc-name">{fileName}</span>
          </div>
          <div className="prob-cwe-detail-location-meta">
            <span className="prob-cwe-detail-loc-line">
              Line <strong>{item.line}</strong>, Col <strong>{item.col}</strong>
            </span>
            <button className="prob-cwe-detail-goto-btn" onClick={onOpen}>
              <IconGoto />
              Open in editor
            </button>
          </div>
        </div>
      </div>

      {/* ── Code ──────────────────────────────────────────────────────────────── */}
      {item.snippet && (
        <div className="prob-cwe-detail-section">
          <div className="prob-cwe-detail-section-label">Code</div>
          <div className="prob-cwe-snippet-block">
            {item.snippet.split('\n').map((codeLine, idx) => {
              const matchIdx = item.snippet_match_idx ?? 0
              const isHighlight = idx === matchIdx
              const lineNo = item.line - matchIdx + idx
              return (
                <div
                  key={idx}
                  className={`prob-cwe-snippet-line${isHighlight ? ' prob-cwe-snippet-line--highlight' : ''}`}
                >
                  <span className="prob-cwe-snippet-lineno">{lineNo}</span>
                  <span className="prob-cwe-snippet-code">{codeLine}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Remediation ───────────────────────────────────────────────────────── */}
      {item.remediation && (
        <div className="prob-cwe-detail-section">
          <div className="prob-cwe-detail-section-label">Remediation</div>
          <div className="prob-cwe-remediation">{item.remediation}</div>
        </div>
      )}

      {/* ── References ────────────────────────────────────────────────────────── */}
      <div className="prob-cwe-detail-section">
        <div className="prob-cwe-detail-section-label">References</div>
        <a
          href={item.mitre_url}
          target="_blank"
          rel="noopener noreferrer"
          className="prob-cwe-detail-ref-link"
          onClick={e => e.stopPropagation()}
        >
          <IconShield />
          MITRE {item.cwe_id} Database
          <IconExternalLink />
        </a>
      </div>

    </div>
  )
}

function CweDetailEmpty({ hasFindings }: { hasFindings: boolean }) {
  return (
    <div className="prob-cwe-detail-empty">
      <span className="prob-cwe-detail-empty-icon">
        <IconShield />
      </span>
      <span className="prob-cwe-detail-empty-title">
        {hasFindings ? 'Select a finding' : 'No findings'}
      </span>
      <span className="prob-cwe-detail-empty-sub">
        {hasFindings
          ? 'Click a finding on the left to view its details, description, and remediation guidance'
          : 'Run the analysis to scan this workspace for known security weaknesses'}
      </span>
    </div>
  )
}

function CweListEmpty({ dismissedCount, onRestore }: { dismissedCount: number; onRestore: () => void }) {
  return (
    <div className="prob-cwe-list-empty">
      <span className="prob-cwe-list-empty-icon ok"><IconCheck /></span>
      <span className="prob-cwe-list-empty-title">
        {dismissedCount > 0 ? 'All findings dismissed' : 'No weaknesses found'}
      </span>
      {dismissedCount > 0 && (
        <button className="prob-cwe-restore-btn" onClick={onRestore}>
          Restore {dismissedCount} dismissed
        </button>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Problems({
  tabId, cwd, sources, items, scanning,
  cweItems = [], cweScanning = false,
  onRescan, onOpenFile, onCweScan,
}: Props) {
  const [mainTab,      setMainTab]      = useState<MainTab>('diagnostics')
  const [diagFilter,   setDiagFilter]   = useState<DiagFilter>('all')
  const [cweSevFilter, setCweSevFilter] = useState<CweItem['severity'] | 'all'>('all')
  const [selectedKey,  setSelectedKey]  = useState<string | null>(null)
  const [dismissed,    setDismissed]    = useState<Set<string>>(loadDismissed)

  // Auto-trigger CWE scan on first visit to the tab
  const hasCweScanned = useRef(false)
  useEffect(() => {
    if (mainTab === 'cwe' && !hasCweScanned.current && cweItems.length === 0 && !cweScanning) {
      hasCweScanned.current = true
      onCweScan?.(cwd)
    }
  }, [mainTab, cwd, cweItems.length, cweScanning, onCweScan])

  // ── Diagnostics state ──────────────────────────────────────────────────────
  const errCount  = useMemo(() => items.filter(i => i.sev === 0).length, [items])
  const warnCount = useMemo(() => items.filter(i => i.sev === 1).length, [items])

  const filteredDiag = useMemo(() => {
    if (diagFilter === 'errors')   return items.filter(i => i.sev === 0)
    if (diagFilter === 'warnings') return items.filter(i => i.sev === 1)
    return items
  }, [items, diagFilter])

  const diagGroups = useMemo(() => {
    const map = new Map<string, ProbItem[]>()
    for (const item of filteredDiag) {
      const arr = map.get(item.file) ?? []
      arr.push(item)
      map.set(item.file, arr)
    }
    return Array.from(map.entries()).map(([file, its]) => ({
      file,
      items: [...its].sort((a, b) => a.line - b.line || a.col - b.col),
    }))
  }, [filteredDiag])

  // ── CWE state ──────────────────────────────────────────────────────────────
  const sortedCwe = useMemo(() => [...cweItems].sort(cweSeveritySort), [cweItems])

  const filteredCwe = useMemo(() => {
    const base = sortedCwe.filter(i => !dismissed.has(cweKey(i)))
    if (cweSevFilter === 'all') return base
    return base.filter(i => i.severity === cweSevFilter)
  }, [sortedCwe, dismissed, cweSevFilter])

  const dismissedCount = useMemo(
    () => cweItems.filter(i => dismissed.has(cweKey(i))).length,
    [cweItems, dismissed]
  )

  const cweCounts = useMemo(() => {
    const visible = sortedCwe.filter(i => !dismissed.has(cweKey(i)))
    const out: Record<string, number> = { all: visible.length }
    for (const s of Object.keys(SEV_META))
      out[s] = visible.filter(i => i.severity === (s as CweItem['severity'])).length
    return out
  }, [sortedCwe, dismissed])

  const selectedItem = useMemo(
    () => filteredCwe.find(i => cweKey(i) === selectedKey) ?? null,
    [filteredCwe, selectedKey]
  )

  // Auto-select first finding when scan completes (transition: scanning → done)
  const prevScanning = useRef(false)
  useEffect(() => {
    if (prevScanning.current && !cweScanning && filteredCwe.length > 0) {
      setSelectedKey(cweKey(filteredCwe[0]))
    }
    prevScanning.current = cweScanning
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cweScanning])

  const handleDismiss = useCallback((item: CweItem) => {
    const key = cweKey(item)
    setDismissed(prev => {
      const next = new Set(prev)
      next.add(key)
      saveDismissed(next)
      return next
    })
    if (selectedKey === key) {
      const idx  = filteredCwe.findIndex(i => cweKey(i) === key)
      const next = filteredCwe[idx + 1] ?? filteredCwe[idx - 1] ?? null
      setSelectedKey(next ? cweKey(next) : null)
    }
  }, [selectedKey, filteredCwe])

  const handleRestoreAll = useCallback(() => {
    const next = new Set<string>()
    saveDismissed(next)
    setDismissed(next)
  }, [])

  const cwdShort = cwd.replace(/\\/g, '/').split('/').slice(-2).join('/')

  return (
    <div className="prob-pane">

      {/* ── Top toolbar ───────────────────────────────────────────────────────── */}
      <div className="prob-toolbar">
        <div className="prob-breadcrumb">
          <span className="prob-breadcrumb-icon"><IconFolder /></span>
          <span className="prob-breadcrumb-path" title={cwd}>{cwdShort || cwd}</span>
          {sources.length > 0 && <span className="prob-breadcrumb-sep">·</span>}
          {sources.map(s => <span key={s} className="prob-source-pill">{s}</span>)}
        </div>
        <div className="prob-toolbar-actions">
          {mainTab === 'diagnostics' && (
            <button
              className="prob-action-btn"
              onClick={() => onRescan(tabId, cwd)}
              disabled={scanning}
            >
              <IconRefresh spinning={scanning} />
              Rescan
            </button>
          )}
          {mainTab === 'cwe' && (
            <button
              className="prob-action-btn"
              onClick={() => onCweScan?.(cwd)}
              disabled={cweScanning}
            >
              <IconRefresh spinning={cweScanning} />
              Analyze
            </button>
          )}
        </div>
      </div>

      {/* ── Tab switcher ──────────────────────────────────────────────────────── */}
      <div className="flex items-stretch border-b border-sep shrink-0">
        <SubNavTabs
          items={[
            { id: 'diagnostics', label: 'Diagnostics', icon: <IconError />, count: items.length },
            { id: 'cwe', label: 'CWE Analysis', icon: <IconShield />, count: cweCounts.all > 0 ? cweCounts.all : undefined },
          ]}
          activeId={mainTab}
          onSelect={id => setMainTab(id as MainTab)}
        />
      </div>

      {/* ── Diagnostics panel ─────────────────────────────────────────────────── */}
      {mainTab === 'diagnostics' && (
        <>
          <div className="prob-filter-bar">
            <SubNavTabs
              size="compact"
              items={[
                { id: 'all',      label: 'All',      count: items.length },
                { id: 'errors',   label: 'Errors',   icon: <span className="text-[var(--color-error)] flex"><IconError /></span>,   count: errCount },
                { id: 'warnings', label: 'Warnings', icon: <span className="text-[var(--color-warning)] flex"><IconWarning /></span>, count: warnCount },
              ]}
              activeId={diagFilter}
              onSelect={id => setDiagFilter(id as DiagFilter)}
            />
            <div className="prob-filter-right">
              {scanning ? (
                <span className="prob-status-dim">Scanning…</span>
              ) : items.length === 0 ? (
                <span className="prob-status-ok"><IconCheck />No problems found</span>
              ) : (
                <span className="prob-status-summary">
                  {errCount > 0 && <span className="err">{errCount} error{errCount !== 1 ? 's' : ''}</span>}
                  {errCount > 0 && warnCount > 0 && <span className="sep"> · </span>}
                  {warnCount > 0 && <span className="warn">{warnCount} warning{warnCount !== 1 ? 's' : ''}</span>}
                </span>
              )}
            </div>
          </div>

          <div className="prob-body">
            {diagGroups.length === 0 && !scanning && (
              <div className="prob-empty">
                <span className={`prob-empty-icon ${items.length === 0 ? 'ok' : 'info'}`}>
                  {items.length === 0 ? <IconCheck /> : <IconInfo />}
                </span>
                <span className="prob-empty-title">
                  {items.length === 0 ? 'No problems detected' : 'No problems match filter'}
                </span>
                <span className="prob-empty-sub">
                  {items.length === 0
                    ? 'All diagnostics passed for this workspace'
                    : 'Try changing the active filter above'}
                </span>
              </div>
            )}

            {diagGroups.map(({ file, items: gItems }) => {
              const { dir, name } = splitPath(cwd, file)
              const gErrCount  = gItems.filter(i => i.sev === 0).length
              const gWarnCount = gItems.filter(i => i.sev === 1).length
              return (
                <div key={file} className="prob-group">
                  <div className="prob-file-header">
                    <span className="prob-file-icon"><IconFile /></span>
                    <span className="prob-file-path" title={file}>
                      {dir && <span className="prob-file-dir">{dir}</span>}
                      <span className="prob-file-name">{name}</span>
                    </span>
                    <div className="prob-file-counts">
                      {gErrCount  > 0 && <span className="prob-file-badge err"><IconError />{gErrCount}</span>}
                      {gWarnCount > 0 && <span className="prob-file-badge warn"><IconWarning />{gWarnCount}</span>}
                    </div>
                  </div>
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
                          onClick={() => onOpenFile(item.file, item.line, item.col)}
                          title={`Open ${name}, line ${item.line}, col ${item.col}`}
                        >
                          <div className="prob-item-row">
                            <span className={`prob-sev-icon ${sevClass}`}>
                              {item.sev === 0 ? <IconError /> : item.sev === 1 ? <IconWarning /> : <IconInfo />}
                            </span>
                            <span className="prob-location">
                              <span className="prob-location-label">Ln</span>{item.line}
                              <span className="prob-location-sep">,</span>
                              <span className="prob-location-label">Col</span>{item.col}
                            </span>
                            {item.code && <span className="prob-code">{item.code}</span>}
                            <span className="prob-msg">{item.msg}</span>
                            <div className="prob-item-end">
                              {isRoot && <span className="prob-root-badge">root cause</span>}
                              <span className="prob-goto"><IconGoto /></span>
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
        </>
      )}

      {/* ── CWE Analysis panel ────────────────────────────────────────────────── */}
      {mainTab === 'cwe' && (
        <>
          {/* Filter bar */}
          <div className={`prob-filter-bar${cweScanning ? ' prob-filter-bar--muted' : ''}`}>
            <button
              className={`prob-filter-btn${cweSevFilter === 'all' ? ' active' : ''}`}
              onClick={() => !cweScanning && setCweSevFilter('all')}
              disabled={cweScanning}
            >
              All
              {!cweScanning && <span className="prob-filter-count">{cweCounts.all}</span>}
            </button>
            {!cweScanning && (Object.keys(SEV_META) as CweItem['severity'][]).map(sev => {
              const count = cweCounts[sev] ?? 0
              if (count === 0 && cweSevFilter !== sev) return null
              const m = SEV_META[sev]
              return (
                <button
                  key={sev}
                  className={`prob-filter-btn${cweSevFilter === sev ? ' active' : ''}`}
                  onClick={() => setCweSevFilter(sev)}
                >
                  <span style={{ color: m.color, display: 'flex', alignItems: 'center' }}>
                    <svg width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3.5" fill="currentColor"/></svg>
                  </span>
                  {m.label}
                  <span className="prob-filter-count">{count}</span>
                </button>
              )
            })}
            <div className="prob-filter-right">
              {cweScanning ? (
                <span className="prob-status-dim">Analyzing…</span>
              ) : dismissedCount > 0 ? (
                <span className="prob-status-dim">{dismissedCount} dismissed</span>
              ) : cweCounts.all === 0 ? (
                <span className="prob-status-ok"><IconCheck />No weaknesses found</span>
              ) : (
                <span className="prob-status-dim">{cweCounts.all} finding{cweCounts.all !== 1 ? 's' : ''}</span>
              )}
            </div>
          </div>

          {/* Two-panel split */}
          <div className="prob-cwe-split">

            {/* ── Left: findings list ────────────────────────────────────────── */}
            <SidebarPanel title="CWE Findings">
              {cweScanning ? (
                <CweListSkeleton />
              ) : filteredCwe.length === 0 ? (
                <CweListEmpty
                  dismissedCount={dismissedCount}
                  onRestore={handleRestoreAll}
                />
              ) : (
                filteredCwe.map(item => (
                  <CweListRow
                    key={cweKey(item)}
                    item={item}
                    cwd={cwd}
                    selected={selectedKey === cweKey(item)}
                    onSelect={() => setSelectedKey(cweKey(item))}
                    onDismiss={() => handleDismiss(item)}
                  />
                ))
              )}
            </SidebarPanel>

            {/* ── Right: detail panel ────────────────────────────────────────── */}
            <div className="prob-cwe-detail-panel">
              {cweScanning ? (
                <CweDetailSkeleton />
              ) : selectedItem ? (
                <CweDetailView
                  item={selectedItem}
                  cwd={cwd}
                  onOpen={() => onOpenFile(selectedItem.file, selectedItem.line, selectedItem.col)}
                  onDismiss={() => handleDismiss(selectedItem)}
                />
              ) : (
                <CweDetailEmpty hasFindings={filteredCwe.length > 0} />
              )}
            </div>

          </div>

          {/* Disclaimer footer */}
          {!cweScanning && cweCounts.all > 0 && (
            <div className="prob-cwe-disclaimer">
              <IconInfo />
              Static pattern matching: verify findings manually before acting on them.
              <a
                href="https://cwe.mitre.org"
                target="_blank"
                rel="noopener noreferrer"
                className="prob-cwe-mitre-link"
              >
                MITRE CWE <IconExternalLink />
              </a>
            </div>
          )}
        </>
      )}

    </div>
  )
}
