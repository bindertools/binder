import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { PortInfo } from '../types'
import { invoke } from '../lib/ipc'
import { Skeleton } from './Skeleton'
import EndpointsTab from './EndpointsTab'
import SubNavTabs from './shared/SubNavTabs'
import './PortsTab.scss'

interface Props {
  tabId: string
  active: boolean
  cwd: string
}

type ProtoFilter = 'all' | 'tcp' | 'udp'
type MainTab = 'open-ports' | 'endpoints'

// ── Icons ─────────────────────────────────────────────────────────────────────

const IconPlug = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path d="M5 1.5V5M11 1.5V5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    <path d="M3.5 5h9v2.5a4.5 4.5 0 01-9 0V5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
    <path d="M8 12v2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
  </svg>
)

const IconEndpoint = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
    <circle cx="4" cy="4" r="2" stroke="currentColor" strokeWidth="1.3"/>
    <circle cx="12" cy="12" r="2" stroke="currentColor" strokeWidth="1.3"/>
    <path d="M5.5 5.5L10.5 10.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    <path d="M9 3.5h3.5V7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const IconChevronUp = () => (
  <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden>
    <path d="M2 6.5L5 3.5L8 6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const IconChevronDown = () => (
  <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden>
    <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const IconRefresh = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
    <path d="M11 6.5C11 9.04 8.76 11 6 11C3.24 11 1 9.04 1 6.5C1 3.96 3.24 2 6 2C7.6 2 9.02 2.72 9.9 3.86" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    <path d="M10 1.5V4.5H7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

// Hoisted to module scope: must keep a stable function identity across
// PortsTab re-renders, otherwise React treats each render's <th> as a new
// component type and tears down/remounts the header on every poll tick,
// which can swallow a click mid-gesture.
const Col = ({ k, label, sortKey, sortAsc, onSort }: {
  k: keyof PortInfo
  label: string
  sortKey: keyof PortInfo
  sortAsc: boolean
  onSort: (k: keyof PortInfo) => void
}) => (
  <th className={`ports__th${sortKey === k ? ' ports__th--active' : ''}`} onClick={() => onSort(k)}>
    <span className="ports__th-inner">
      {label}
      {sortKey === k && (sortAsc ? <IconChevronUp /> : <IconChevronDown />)}
    </span>
  </th>
)

// ── Skeleton ──────────────────────────────────────────────────────────────────

function PortsSkeleton() {
  return (
    <div className="ports__skeleton">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="ports__skeleton-row">
          <div className="ports__skeleton-stack">
            <Skeleton width={40} height={13} />
            <Skeleton width={28} height={10} />
          </div>
          <Skeleton width={64} height={12} />
          <div className="ports__skeleton-stack">
            <Skeleton width={110} height={13} />
            <Skeleton width={50} height={10} />
          </div>
          <Skeleton width={120} height={12} />
          <Skeleton width={40} height={20} radius="var(--r-sm)" />
        </div>
      ))}
    </div>
  )
}

export default function PortsTab({ active, cwd }: Props) {
  const [mainTab, setMainTab] = useState<MainTab>('open-ports')
  const [ports, setPorts] = useState<PortInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [protoFilter, setProtoFilter] = useState<ProtoFilter>('all')
  const [stateFilter, setStateFilter] = useState('all')
  const [sortKey, setSortKey] = useState<keyof PortInfo>('port')
  const [sortAsc, setSortAsc] = useState(true)
  const [killing, setKilling] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  const refresh = useCallback(() => {
    invoke<{ ports: PortInfo[] }>('sysinfo.ports')
      .then(r => setPorts(r.ports ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!active || mainTab !== 'open-ports') return
    refresh()
    const id = setInterval(refresh, 5000)
    return () => clearInterval(id)
  }, [active, mainTab, refresh])

  const handleSort = (key: keyof PortInfo) => {
    if (sortKey === key) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(true) }
  }

  const handleKill = async (port: PortInfo) => {
    setKilling(String(port.port))
    try {
      const r = await invoke<{ result: string }>('sysinfo.ports.kill', { port: port.port })
      setMessage(r.result)
      setTimeout(() => { setMessage(''); refresh() }, 2000)
    } catch (e: any) {
      setMessage(e?.message ?? String(e))
      setTimeout(() => setMessage(''), 3000)
    } finally {
      setKilling(null)
    }
  }

  const states = useMemo(() => {
    const s = new Set<string>()
    for (const p of ports) if (p.state) s.add(p.state)
    return [...s].sort()
  }, [ports])

  const filtered = useMemo(() => ports.filter(p => {
    if (protoFilter !== 'all' && p.protocol.toLowerCase() !== protoFilter) return false
    if (stateFilter !== 'all' && p.state !== stateFilter) return false
    if (!filter) return true
    const q = filter.toLowerCase()
    return String(p.port).includes(q) || p.protocol.includes(q) ||
      p.state.toLowerCase().includes(q) || p.process.toLowerCase().includes(q)
  }), [ports, protoFilter, stateFilter, filter])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    arr.sort((a, b) => {
      const av = a[sortKey] ?? ''
      const bv = b[sortKey] ?? ''
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : av < bv ? -1 : av > bv ? 1 : 0
      return sortAsc ? cmp : -cmp
    })
    return arr
  }, [filtered, sortKey, sortAsc])

  const StateDot = ({ state }: { state: string }) => (
    <span className={`ports__dot ports__dot--${state.toLowerCase()}`} />
  )

  return (
    <div className="ports">
      <div className="flex items-stretch border-b border-sep shrink-0">
        <SubNavTabs
          items={[
            { id: 'open-ports', label: 'Open Ports', icon: <IconPlug /> },
            { id: 'endpoints', label: 'Endpoints', icon: <IconEndpoint /> },
          ]}
          activeId={mainTab}
          onSelect={id => setMainTab(id as MainTab)}
        />
      </div>

      {mainTab === 'open-ports' && (
        <>
          <div className="ports__toolbar">
            <input
              className="ports__filter"
              placeholder="filter ports…"
              value={filter}
              onChange={e => setFilter(e.target.value)}
            />
            <select
              className="ports__select"
              value={protoFilter}
              onChange={e => setProtoFilter(e.target.value as ProtoFilter)}
              title="Filter by protocol"
            >
              <option value="all">All protocols</option>
              <option value="tcp">TCP</option>
              <option value="udp">UDP</option>
            </select>
            <select
              className="ports__select"
              value={stateFilter}
              onChange={e => setStateFilter(e.target.value)}
              title="Filter by state"
            >
              <option value="all">All states</option>
              {states.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button className="ports__refresh" onClick={refresh}><IconRefresh /> Refresh</button>
            {message && <span className="ports__msg">{message}</span>}
          </div>
          {loading ? <PortsSkeleton /> : (
            <div className="ports__table-wrap">
              <table className="ports__table">
                <thead>
                  <tr>
                    <Col k="port"    label="Port"    sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} />
                    <Col k="state"   label="State"   sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} />
                    <Col k="process" label="Process" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} />
                    <Col k="address" label="Address" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} />
                    <th className="ports__th ports__th--action">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((p, i) => (
                    <tr key={`${p.protocol}:${p.address}:${p.port}:${p.pid}:${i}`} className="ports__row">
                      <td className="ports__cell">
                        <div className="ports__primary ports__port">{p.port}</div>
                        <div className="ports__secondary">{p.protocol.toLowerCase()}</div>
                      </td>
                      <td className="ports__cell">
                        <div className="ports__state-line">
                          <StateDot state={p.state} />
                          <span className="ports__primary">{p.state || '-'}</span>
                        </div>
                      </td>
                      <td className="ports__cell">
                        <div className="ports__primary">{p.process || '-'}</div>
                        {!!p.pid && <div className="ports__secondary">pid {p.pid}</div>}
                      </td>
                      <td className="ports__cell ports__addr">{p.address}</td>
                      <td className="ports__cell ports__action">
                        <button
                          className="ports__kill"
                          disabled={killing === String(p.port)}
                          onClick={() => handleKill(p)}
                        >
                          {killing === String(p.port) ? '…' : 'Kill'}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {sorted.length === 0 && (
                    <tr><td colSpan={5} className="ports__empty">no ports match your filters</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {mainTab === 'endpoints' && (
        <EndpointsTab cwd={cwd} active={active && mainTab === 'endpoints'} />
      )}
    </div>
  )
}
