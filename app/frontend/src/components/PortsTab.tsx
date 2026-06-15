import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { PortInfo } from '../types'
import { GetSystemPorts, KillPort } from '../../wailsjs/go/main/App'
import { Skeleton } from './Skeleton'
import EndpointsTab from './EndpointsTab'
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

// ── Skeleton ──────────────────────────────────────────────────────────────────

function PortsSkeleton() {
  return (
    <div className="ports__skeleton">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="ports__skeleton-row">
          <Skeleton width={44} height={12} />
          <Skeleton width={34} height={12} />
          <Skeleton width={72} height={18} radius="var(--r-xl)" />
          <Skeleton width={40} height={12} />
          <Skeleton width={130} height={12} />
          <Skeleton width={100} height={12} />
          <Skeleton width={46} height={22} radius="var(--r-sm)" />
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
    GetSystemPorts()
      .then(p => setPorts(p ?? []))
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
      const msg = await KillPort(String(port.port))
      setMessage(msg)
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

  const filtered = ports.filter(p => {
    if (protoFilter !== 'all' && p.protocol.toLowerCase() !== protoFilter) return false
    if (stateFilter !== 'all' && p.state !== stateFilter) return false
    if (!filter) return true
    const q = filter.toLowerCase()
    return String(p.port).includes(q) || p.protocol.includes(q) ||
      p.state.toLowerCase().includes(q) || p.process.toLowerCase().includes(q)
  })

  const sorted = [...filtered].sort((a, b) => {
    const av = a[sortKey] ?? ''
    const bv = b[sortKey] ?? ''
    const cmp = av < bv ? -1 : av > bv ? 1 : 0
    return sortAsc ? cmp : -cmp
  })

  const Col = ({ k, label }: { k: keyof PortInfo; label: string }) => (
    <th className={`ports__th${sortKey === k ? ' ports__th--active' : ''}`} onClick={() => handleSort(k)}>
      <span className="ports__th-inner">
        {label}
        {sortKey === k && (sortAsc ? <IconChevronUp /> : <IconChevronDown />)}
      </span>
    </th>
  )

  return (
    <div className="ports">
      <div className="ports__tab-switcher">
        <button
          className={`ports__main-tab${mainTab === 'open-ports' ? ' active' : ''}`}
          onClick={() => setMainTab('open-ports')}
        >
          <IconPlug />
          Open Ports
        </button>
        <button
          className={`ports__main-tab${mainTab === 'endpoints' ? ' active' : ''}`}
          onClick={() => setMainTab('endpoints')}
        >
          <IconEndpoint />
          Endpoints
        </button>
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
                    <Col k="port"     label="Port" />
                    <Col k="protocol" label="Proto" />
                    <Col k="state"    label="State" />
                    <Col k="pid"      label="PID" />
                    <Col k="process"  label="Process" />
                    <Col k="address"  label="Address" />
                    <th className="ports__th">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((p, i) => (
                    <tr key={i} className="ports__row">
                      <td className="ports__port">{p.port}</td>
                      <td className="ports__proto">{p.protocol}</td>
                      <td className={`ports__state ports__state--${p.state.toLowerCase()}`}>{p.state || '-'}</td>
                      <td className="ports__pid">{p.pid || '-'}</td>
                      <td className="ports__process">{p.process || '-'}</td>
                      <td className="ports__addr">{p.address}</td>
                      <td className="ports__action">
                        <button
                          className="ports__kill"
                          disabled={killing === String(p.port)}
                          onClick={() => handleKill(p)}
                        >
                          {killing === String(p.port) ? '…' : 'kill'}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {sorted.length === 0 && (
                    <tr><td colSpan={7} className="ports__empty">no ports match your filters</td></tr>
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
