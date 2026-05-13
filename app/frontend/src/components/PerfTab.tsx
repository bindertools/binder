import React, { useEffect, useRef, useState } from 'react'
import { PerfData } from '../types'
import { StartPerfMonitor, StopPerfMonitor } from '../../wailsjs/go/main/App'
import { EventsOn, EventsOff } from '../../wailsjs/runtime/runtime'
import './PerfTab.css'

interface Props { tabId: string; active: boolean }

const MAX_POINTS = 60

function fmt(bytes: number): string {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + ' GB'
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB'
  if (bytes >= 1e3) return (bytes / 1e3).toFixed(1) + ' KB'
  return bytes + ' B'
}

function Gauge({ value, label, color }: { value: number; label: string; color: string }) {
  const r = 38
  const circ = 2 * Math.PI * r
  const pct = Math.min(100, Math.max(0, value))
  const dash = circ * pct / 100
  return (
    <div className="perf-gauge">
      <svg width="96" height="96" viewBox="0 0 96 96">
        <circle cx="48" cy="48" r={r} stroke="rgba(255,255,255,0.07)" strokeWidth="7" fill="none"/>
        <circle cx="48" cy="48" r={r} stroke={color} strokeWidth="7" fill="none"
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeLinecap="round"
          transform="rotate(-90 48 48)"
          style={{ transition: 'stroke-dasharray 0.4s ease' }}
        />
        <text x="48" y="53" textAnchor="middle" fill="#ddd" fontSize="15" fontWeight="600">
          {pct.toFixed(0)}%
        </text>
      </svg>
      <div className="perf-gauge__label">{label}</div>
    </div>
  )
}

function Sparkline({ points, color }: { points: number[]; color: string }) {
  const W = 240, H = 48
  const max = Math.max(...points, 1)
  const pts = points.map((v, i) => {
    const x = (i / (MAX_POINTS - 1)) * W
    const y = H - (v / max) * H
    return `${x},${y}`
  }).join(' ')
  return (
    <svg width={W} height={H} className="perf-spark">
      {points.length > 1 && (
        <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round"/>
      )}
    </svg>
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
    StartPerfMonitor(tabId).catch(() => {})

    EventsOn(event, (d: PerfData) => {
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
      StopPerfMonitor(tabId).catch(() => {})
      EventsOff(event)
    }
  }, [tabId, active])

  if (!data) {
    return <div className="perf perf--loading">collecting metrics…</div>
  }

  return (
    <div className="perf">
      <div className="perf__gauges">
        <Gauge value={data.cpu_percent}  label="CPU"  color="#4fc3f7" />
        <Gauge value={data.mem_percent}  label="RAM"  color="#81c995" />
        <Gauge value={data.disk_percent} label="Disk" color="#ffb74d" />
        {data.gpu_available && <Gauge value={data.gpu_percent} label="GPU" color="#ce93d8" />}
      </div>

      <div className="perf__charts">
        <div className="perf__chart">
          <span className="perf__chart-label" style={{ color: '#4fc3f7' }}>CPU</span>
          <Sparkline points={cpuHist.current} color="#4fc3f7" />
        </div>
        <div className="perf__chart">
          <span className="perf__chart-label" style={{ color: '#81c995' }}>RAM</span>
          <Sparkline points={memHist.current} color="#81c995" />
        </div>
      </div>

      <div className="perf__stats">
        <div className="perf__stat">
          <span className="perf__stat-label">Memory</span>
          <span className="perf__stat-value">{fmt(data.mem_used)} / {fmt(data.mem_total)}</span>
        </div>
        <div className="perf__stat">
          <span className="perf__stat-label">Disk</span>
          <span className="perf__stat-value">{fmt(data.disk_used)} / {fmt(data.disk_total)}</span>
        </div>
        <div className="perf__stat">
          <span className="perf__stat-label">Net ↑</span>
          <span className="perf__stat-value">{fmt(data.net_bytes_sent)}</span>
        </div>
        <div className="perf__stat">
          <span className="perf__stat-label">Net ↓</span>
          <span className="perf__stat-value">{fmt(data.net_bytes_recv)}</span>
        </div>
        {data.gpu_available && (
          <div className="perf__stat">
            <span className="perf__stat-label">GPU</span>
            <span className="perf__stat-value">{data.gpu_name} — {data.gpu_percent.toFixed(0)}%</span>
          </div>
        )}
      </div>
    </div>
  )
}
