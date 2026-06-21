import React, { useEffect, useRef, useState } from 'react'
import { PerfData } from '../types'
import { invoke, on, offAll } from '../lib/ipc'
import { Skeleton } from './Skeleton'
import './PerfTab.scss'

interface Props { tabId: string; active: boolean }

const MAX_POINTS = 60

function fmt(bytes: number): string {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + ' GB'
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB'
  if (bytes >= 1e3) return (bytes / 1e3).toFixed(1) + ' KB'
  return bytes + ' B'
}

function GaugeCard({ value, label, color, sublabel }: { value: number; label: string; color: string; sublabel?: string }) {
  const r = 34
  const circ = 2 * Math.PI * r
  const pct = Math.min(100, Math.max(0, value))
  const dash = circ * pct / 100
  return (
    <div className="perf-card perf-card--gauge">
      <svg width="88" height="88" viewBox="0 0 88 88">
        <circle cx="44" cy="44" r={r} stroke="var(--sep)" strokeWidth="6" fill="none"/>
        <circle cx="44" cy="44" r={r} stroke={color} strokeWidth="6" fill="none"
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeLinecap="round"
          transform="rotate(-90 44 44)"
          style={{ transition: 'stroke-dasharray 0.4s ease' }}
        />
        <text x="44" y="49" textAnchor="middle" fill="var(--info-bar-hover-color)" fontSize="14" fontWeight="600" fontFamily="var(--font-ui)">
          {pct.toFixed(0)}%
        </text>
      </svg>
      <div className="perf-card__label">{label}</div>
      {sublabel && <div className="perf-card__sublabel">{sublabel}</div>}
    </div>
  )
}

function SparkCard({ label, color, points, current }: { label: string; color: string; points: number[]; current: number }) {
  const W = 180, H = 40
  const max = Math.max(...points, 1)
  const pts = points.map((v, i) => {
    const x = (i / (MAX_POINTS - 1)) * W
    const y = H - (v / max) * (H - 4) - 2
    return `${x},${y}`
  }).join(' ')

  return (
    <div className="perf-card perf-card--spark">
      <div className="perf-spark__header">
        <span className="perf-spark__name" style={{ color }}>{label}</span>
        <span className="perf-spark__value">{current.toFixed(1)}%</span>
      </div>
      <svg width={W} height={H} className="perf-spark__svg">
        <defs>
          <linearGradient id={`grad-${label}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25"/>
            <stop offset="100%" stopColor={color} stopOpacity="0"/>
          </linearGradient>
        </defs>
        {points.length > 1 && (
          <>
            <polygon
              points={`0,${H} ${pts} ${W},${H}`}
              fill={`url(#grad-${label})`}
            />
            <polyline
              points={pts}
              fill="none"
              stroke={color}
              strokeWidth="1.5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </>
        )}
      </svg>
    </div>
  )
}

const NetUpIcon = () => (
  <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M6 9V1M3 3l3-3 3 3"/>
  </svg>
)
const NetDownIcon = () => (
  <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M6 1v8M3 7l3 3 3-3"/>
  </svg>
)

function StatRow({ label, value }: { label: React.ReactNode; value: string }) {
  return (
    <div className="perf-stat">
      <span className="perf-stat__label">{label}</span>
      <span className="perf-stat__value">{value}</span>
    </div>
  )
}

function PerfSkeleton() {
  return (
    <div className="perf perf--skeleton">
      <div className="perf__gauges">
        {[1,2,3].map(i => (
          <div key={i} className="perf-card perf-card--gauge">
            <Skeleton width={88} height={88} radius="50%" />
            <Skeleton width={48} height={11} style={{ marginTop: 8 }} />
          </div>
        ))}
      </div>
      <div className="perf__sparks">
        {[1,2].map(i => (
          <div key={i} className="perf-card perf-card--spark">
            <div className="perf-spark__header">
              <Skeleton width={32} height={11} />
              <Skeleton width={40} height={11} />
            </div>
            <Skeleton width="100%" height={40} radius="var(--r-sm)" style={{ marginTop: 8 }} />
          </div>
        ))}
      </div>
      <div className="perf__stats-card">
        {[1,2,3,4].map(i => (
          <div key={i} className="perf-stat">
            <Skeleton width={64} height={11} />
            <Skeleton width={88} height={11} />
          </div>
        ))}
      </div>
    </div>
  )
}

export default function PerfTab({ tabId, active }: Props) {
  const [data, setData] = useState<PerfData | null>(null)
  const cpuHist  = useRef<number[]>([])
  const memHist  = useRef<number[]>([])
  const diskHist = useRef<number[]>([])
  const [, forceUpdate] = useState(0)

  useEffect(() => {
    if (!active) return
    const event = `perf:data:${tabId}`
    invoke('sysinfo.perf.start', { id: tabId }).catch(() => {})

    on(event, (raw: unknown) => {
      const d = raw as PerfData
      setData(d)
      const push = (arr: number[], v: number) => {
        arr.push(v)
        if (arr.length > MAX_POINTS) arr.shift()
      }
      push(cpuHist.current,  d.cpu_percent)
      push(memHist.current,  d.mem_percent)
      push(diskHist.current, d.disk_percent)
      forceUpdate(n => n + 1)
    })

    return () => {
      invoke('sysinfo.perf.stop', { id: tabId }).catch(() => {})
      offAll(event)
    }
  }, [tabId, active])

  if (!data) return <PerfSkeleton />

  return (
    <div className="perf">
      <div className="perf__gauges">
        <GaugeCard value={data.cpu_percent}  label="CPU"  color="var(--accent)" />
        <GaugeCard value={data.mem_percent}  label="RAM"  color="var(--color-success)" />
        <GaugeCard value={data.disk_percent} label="Disk" color="var(--color-warning)" />
        {data.gpu_available && <GaugeCard value={data.gpu_percent} label="GPU" color="var(--color-purple)" sublabel={data.gpu_name} />}
      </div>

      <div className="perf__sparks">
        <SparkCard label="CPU" color="var(--accent)"         points={cpuHist.current}  current={data.cpu_percent} />
        <SparkCard label="RAM" color="var(--color-success)"  points={memHist.current}  current={data.mem_percent} />
      </div>

      <div className="perf__stats-card">
        <StatRow label="Memory"  value={`${fmt(data.mem_used)} / ${fmt(data.mem_total)}`} />
        <StatRow label="Disk"    value={`${fmt(data.disk_used)} / ${fmt(data.disk_total)}`} />
        <StatRow label={<>Net <NetUpIcon /></>}   value={fmt(data.net_bytes_sent)} />
        <StatRow label={<>Net <NetDownIcon /></>} value={fmt(data.net_bytes_recv)} />
        {data.gpu_available && (
          <StatRow label="GPU" value={`${data.gpu_name} (${data.gpu_percent.toFixed(0)}%)`} />
        )}
      </div>
    </div>
  )
}
