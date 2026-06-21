import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { PortInfo, PortForward } from '../types'
import { invoke } from '../lib/ipc'
import { Skeleton } from './Skeleton'
import EndpointsTab from './EndpointsTab'
import NewPortForwardModal from './NewPortForwardModal'
import SubNavTabs from './shared/SubNavTabs'
import SortableColumnHeader, { ColumnDef } from './shared/SortableColumnHeader'
import './PortsTab.scss'

interface Props {
  tabId: string
  active: boolean
  cwd: string
}

type ProtoFilter = 'all' | 'tcp' | 'udp'
type MainTab = 'open-ports' | 'forwards' | 'endpoints'

// ── Icons ─────────────────────────────────────────────────────────────────────

const IconPlug = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path d="M5 1.5V5M11 1.5V5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    <path d="M3.5 5h9v2.5a4.5 4.5 0 01-9 0V5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
    <path d="M8 12v2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
  </svg>
)

const IconForward = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path d="M2 8h9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    <path d="M8.5 4.5L12.5 8L8.5 11.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
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

const IconRefresh = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
    <path d="M11 6.5C11 9.04 8.76 11 6 11C3.24 11 1 9.04 1 6.5C1 3.96 3.24 2 6 2C7.6 2 9.02 2.72 9.9 3.86" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    <path d="M10 1.5V4.5H7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const PORT_COLUMNS: ColumnDef<keyof PortInfo>[] = [
  { key: 'port', label: 'Port' },
  { key: 'state', label: 'State' },
  { key: 'process', label: 'Process' },
  { key: 'address', label: 'Address' },
]

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
  const [visibleColumns, setVisibleColumns] = useState<Set<keyof PortInfo>>(
    () => new Set(PORT_COLUMNS.map(c => c.key))
  )

  const [forwards, setForwards] = useState<PortForward[]>([])
  const [forwardsLoading, setForwardsLoading] = useState(true)
  const [showNewForward, setShowNewForward] = useState(false)
  const [forwardMessage, setForwardMessage] = useState('')

  const refresh = useCallback(() => {
    invoke<{ ports: PortInfo[] }>('sysinfo.ports')
      .then(r => setPorts(r.ports ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const refreshForwards = useCallback(() => {
    invoke<{ forwards: PortForward[] }>('portforward.list')
      .then(r => setForwards(r.forwards ?? []))
      .catch(() => {})
      .finally(() => setForwardsLoading(false))
  }, [])

  useEffect(() => {
    if (!active || mainTab !== 'forwards') return
    refreshForwards()
    const id = setInterval(refreshForwards, 5000)
    return () => clearInterval(id)
  }, [active, mainTab, refreshForwards])

  const handleCreateForward = (forward: {
    name: string
    protocol: 'tcp' | 'udp' | 'both'
    listen_port: number
    target_host: string
    target_port: number
    enabled: boolean
  }) => {
    invoke<{ forward: PortForward }>('portforward.add', { forward })
      .then(() => { setShowNewForward(false); refreshForwards() })
      .catch(e => setForwardMessage(e?.message ?? String(e)))
  }

  const handleToggleForward = (fwd: PortForward) => {
    invoke('portforward.toggle', { id: fwd.id, enabled: !fwd.enabled })
      .then(refreshForwards)
      .catch(() => {})
  }

  const handleRemoveForward = (fwd: PortForward) => {
    invoke('portforward.remove', { id: fwd.id })
      .then(refreshForwards)
      .catch(() => {})
  }

  useEffect(() => {
    if (!active || mainTab !== 'open-ports') return
    refresh()
    const id = setInterval(refresh, 5000)
    return () => clearInterval(id)
  }, [active, mainTab, refresh])

  const sortAscBy = (key: keyof PortInfo) => { setSortKey(key); setSortAsc(true) }
  const sortDescBy = (key: keyof PortInfo) => { setSortKey(key); setSortAsc(false) }

  const toggleColumn = (key: keyof PortInfo) => {
    setVisibleColumns(prev => {
      if (prev.has(key) && prev.size === 1) return prev
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
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

  const protocolFilterContent = (
    <div>
      <div className="col-menu__label">Protocol</div>
      {(['all', 'tcp', 'udp'] as const).map(p => (
        <button
          key={p}
          className={`col-menu__item${protoFilter === p ? ' col-menu__item--active' : ''}`}
          onClick={() => setProtoFilter(p)}
        >
          {p === 'all' ? 'All protocols' : p.toUpperCase()}
        </button>
      ))}
    </div>
  )

  const stateFilterContent = (
    <div>
      <div className="col-menu__label">State</div>
      <button
        className={`col-menu__item${stateFilter === 'all' ? ' col-menu__item--active' : ''}`}
        onClick={() => setStateFilter('all')}
      >
        All states
      </button>
      {states.map(s => (
        <button
          key={s}
          className={`col-menu__item${stateFilter === s ? ' col-menu__item--active' : ''}`}
          onClick={() => setStateFilter(s)}
        >
          {s}
        </button>
      ))}
    </div>
  )

  return (
    <div className="ports">
      <div className="flex items-stretch border-b border-sep shrink-0">
        <SubNavTabs
          items={[
            { id: 'open-ports', label: 'Open Ports', icon: <IconPlug /> },
            { id: 'forwards', label: 'Forwards', icon: <IconForward /> },
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
            <button className="ports__refresh" onClick={refresh}><IconRefresh /> Refresh</button>
            {message && <span className="ports__msg">{message}</span>}
          </div>
          {loading ? <PortsSkeleton /> : (
            <div className="ports__table-wrap">
              <table className="ports__table">
                <thead>
                  <tr>
                    {visibleColumns.has('port') && (
                      <SortableColumnHeader
                        label="Port"
                        active={sortKey === 'port'}
                        sortAsc={sortAsc}
                        onSortAsc={() => sortAscBy('port')}
                        onSortDesc={() => sortDescBy('port')}
                        thClassName={`ports__th${sortKey === 'port' ? ' ports__th--active' : ''}`}
                        innerClassName="ports__th-inner"
                        filterContent={protocolFilterContent}
                        columns={PORT_COLUMNS}
                        visibleColumns={visibleColumns}
                        onToggleColumn={toggleColumn}
                      />
                    )}
                    {visibleColumns.has('state') && (
                      <SortableColumnHeader
                        label="State"
                        active={sortKey === 'state'}
                        sortAsc={sortAsc}
                        onSortAsc={() => sortAscBy('state')}
                        onSortDesc={() => sortDescBy('state')}
                        thClassName={`ports__th${sortKey === 'state' ? ' ports__th--active' : ''}`}
                        innerClassName="ports__th-inner"
                        filterContent={stateFilterContent}
                        columns={PORT_COLUMNS}
                        visibleColumns={visibleColumns}
                        onToggleColumn={toggleColumn}
                      />
                    )}
                    {visibleColumns.has('process') && (
                      <SortableColumnHeader
                        label="Process"
                        active={sortKey === 'process'}
                        sortAsc={sortAsc}
                        onSortAsc={() => sortAscBy('process')}
                        onSortDesc={() => sortDescBy('process')}
                        thClassName={`ports__th${sortKey === 'process' ? ' ports__th--active' : ''}`}
                        innerClassName="ports__th-inner"
                        columns={PORT_COLUMNS}
                        visibleColumns={visibleColumns}
                        onToggleColumn={toggleColumn}
                      />
                    )}
                    {visibleColumns.has('address') && (
                      <SortableColumnHeader
                        label="Address"
                        active={sortKey === 'address'}
                        sortAsc={sortAsc}
                        onSortAsc={() => sortAscBy('address')}
                        onSortDesc={() => sortDescBy('address')}
                        thClassName={`ports__th${sortKey === 'address' ? ' ports__th--active' : ''}`}
                        innerClassName="ports__th-inner"
                        columns={PORT_COLUMNS}
                        visibleColumns={visibleColumns}
                        onToggleColumn={toggleColumn}
                      />
                    )}
                    <th className="ports__th ports__th--action">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((p, i) => (
                    <tr key={`${p.protocol}:${p.address}:${p.port}:${p.pid}:${i}`} className="ports__row">
                      {visibleColumns.has('port') && (
                        <td className="ports__cell">
                          <div className="ports__primary ports__port">{p.port}</div>
                          <div className="ports__secondary">{p.protocol.toLowerCase()}</div>
                        </td>
                      )}
                      {visibleColumns.has('state') && (
                        <td className="ports__cell">
                          <div className="ports__state-line">
                            <StateDot state={p.state} />
                            <span className="ports__primary">{p.state || '-'}</span>
                          </div>
                        </td>
                      )}
                      {visibleColumns.has('process') && (
                        <td className="ports__cell">
                          <div className="ports__primary">{p.process || '-'}</div>
                          {!!p.pid && <div className="ports__secondary">pid {p.pid}</div>}
                        </td>
                      )}
                      {visibleColumns.has('address') && (
                        <td className="ports__cell ports__addr">{p.address}</td>
                      )}
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
                    <tr><td colSpan={visibleColumns.size + 1} className="ports__empty">no ports match your filters</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {mainTab === 'forwards' && (
        <>
          <div className="ports__toolbar">
            <span className="ports__msg" style={{ flex: 1, color: 'var(--info-bar-color)', opacity: 0.7 }}>
              Local TCP/UDP relays — listens on this machine and forwards to another host:port reachable from it. Does not touch router/UPnP/NAT settings.
            </span>
            <button className="ports__refresh" onClick={() => setShowNewForward(true)}>
              <Plus size={13} /> New Forward
            </button>
            {forwardMessage && <span className="ports__msg" style={{ color: 'var(--color-error)' }}>{forwardMessage}</span>}
          </div>
          {forwardsLoading ? <PortsSkeleton /> : forwards.length === 0 ? (
            <div className="ports__empty">
              No port forwards configured. Click "New Forward" to relay a local port to another host:port on this machine.
            </div>
          ) : (
            <div className="ports__table-wrap">
              <table className="ports__table">
                <thead>
                  <tr>
                    <th className="ports__th">Name</th>
                    <th className="ports__th">Protocol</th>
                    <th className="ports__th">Listen</th>
                    <th className="ports__th">Target</th>
                    <th className="ports__th">Status</th>
                    <th className="ports__th ports__th--action">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {forwards.map(fwd => (
                    <tr key={fwd.id} className="ports__row">
                      <td className="ports__cell">
                        <div className="ports__primary">{fwd.name}</div>
                      </td>
                      <td className="ports__cell ports__addr">{fwd.protocol.toUpperCase()}</td>
                      <td className="ports__cell ports__addr">127.0.0.1:{fwd.listen_port}</td>
                      <td className="ports__cell ports__addr">{fwd.target_host}:{fwd.target_port}</td>
                      <td className="ports__cell">
                        <div className="ports__state-line">
                          <span className={`ports__dot ports__dot--${fwd.status === 'running' ? 'listen' : fwd.status === 'error' ? 'close_wait' : 'time_wait'}`} />
                          <span className="ports__primary" title={fwd.error}>{fwd.status}</span>
                        </div>
                      </td>
                      <td className="ports__cell ports__action" style={{ display: 'flex', gap: 6 }}>
                        <button className="ports__kill" onClick={() => handleToggleForward(fwd)}>
                          {fwd.enabled ? 'Disable' : 'Enable'}
                        </button>
                        <button className="ports__kill" onClick={() => handleRemoveForward(fwd)}>
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {mainTab === 'endpoints' && (
        <EndpointsTab cwd={cwd} active={active && mainTab === 'endpoints'} />
      )}

      <NewPortForwardModal
        open={showNewForward}
        onCreate={handleCreateForward}
        onDismiss={() => setShowNewForward(false)}
      />
    </div>
  )
}
