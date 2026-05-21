import React, { useEffect, useRef, useState } from 'react'
import { Install, GetInstallDir, GetReleases, LaunchAndClose, CloseInstaller } from '../wailsjs/go/main/App'
import { EventsOn } from '../wailsjs/runtime/runtime'

type Phase = 'ready' | 'installing' | 'done' | 'error'

interface ReleaseInfo { tag: string; prerelease: boolean }

const drag   = { '--wails-draggable': 'drag'    } as React.CSSProperties
const noDrag = { '--wails-draggable': 'no-drag' } as React.CSSProperties

function VersionSelect({ value, onChange, releases }: {
  value: string
  onChange: (v: string) => void
  releases: ReleaseInfo[]
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const selectedRelease = releases.find(r => r.tag === value)

  return (
    <div className="vsel" ref={ref}>
      <button className="vsel-btn" data-open={String(open)} onClick={() => setOpen(o => !o)}>
        <span>
          {value === 'latest' ? 'Latest (stable)' : value}
          {selectedRelease?.prerelease && <span className="vsel-snapshot"> ⚠ Snapshot</span>}
        </span>
        <svg className="vsel-chevron" width="10" height="6" viewBox="0 0 10 6" fill="none">
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      {open && (
        <div className="vsel-menu">
          <div
            className={`vsel-item${value === 'latest' ? ' active' : ''}`}
            onClick={() => { onChange('latest'); setOpen(false) }}
          >
            Latest (stable)
          </div>
          {releases.map(r => (
            <div
              key={r.tag}
              className={`vsel-item${value === r.tag ? ' active' : ''}${r.prerelease ? ' vsel-item--pre' : ''}`}
              onClick={() => { onChange(r.tag); setOpen(false) }}
            >
              <span>{r.tag}</span>
              {r.prerelease && <span className="vsel-badge">Snapshot</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function App() {
  const [phase,           setPhase]          = useState<Phase>('ready')
  const [progress,        setProgress]       = useState(0)
  const [statusMsg,       setStatusMsg]      = useState('')
  const [error,           setError]          = useState('')
  const [installDir,      setInstallDir]     = useState('')
  const [createShortcut,  setCreateShortcut] = useState(true)
  const [installPlugins,  setInstallPlugins] = useState(false)
  const [version,         setVersion]        = useState('latest')
  const [releases,        setReleases]       = useState<ReleaseInfo[]>([])

  useEffect(() => {
    GetInstallDir().then(setInstallDir)
    GetReleases().then(list => { if (list && list.length > 0) setReleases(list) })
    EventsOn('install:progress', (pct: number, msg: string) => {
      setProgress(pct)
      setStatusMsg(msg)
      if (pct >= 100) setPhase('done')
    })
  }, [])

  const handleInstall = async () => {
    setPhase('installing')
    setProgress(0)
    setStatusMsg('Starting…')
    try {
      await Install(version, createShortcut, installPlugins)
    } catch (e: unknown) {
      setError(String(e))
      setPhase('error')
    }
  }

  return (
    <div className="installer" style={drag}>

      <button className="btn-close" style={noDrag} onClick={CloseInstaller}>✕</button>

      <div className="content">
        <div className="brand">
          <img src="/lockup-dark.svg" alt="cmdIDE" className="brand-lockup" draggable={false} />
        </div>

        {phase === 'ready' && (
          <div className="ready" style={noDrag}>
            <p className="install-dir-label">Installing to</p>
            <p className="install-dir-path">{installDir}</p>

            {releases.length > 0 && (
              <div className="version-row">
                <span className="version-label">Version</span>
                <VersionSelect value={version} onChange={setVersion} releases={releases} />
              </div>
            )}

            <div className="options">
              <label className="opt-row">
                <input type="checkbox" checked={createShortcut} onChange={e => setCreateShortcut(e.target.checked)} />
                <span>Desktop shortcut</span>
              </label>
              <label className="opt-row">
                <input type="checkbox" checked={installPlugins} onChange={e => setInstallPlugins(e.target.checked)} />
                <span>Plugin Manager</span>
              </label>
            </div>

            <button className="btn-install" onClick={handleInstall}>Install</button>
          </div>
        )}

        {phase === 'installing' && <p className="status-msg">{statusMsg}</p>}

        {phase === 'done' && (
          <div className="done" style={noDrag}>
            <p className="status-msg success">Installed successfully</p>
            <div className="actions">
              <button className="btn-action btn-launch" onClick={LaunchAndClose}>Launch</button>
              <button className="btn-action" onClick={CloseInstaller}>Close</button>
            </div>
          </div>
        )}

        {phase === 'error' && (
          <div className="error-block" style={noDrag}>
            <p className="status-msg error">{error}</p>
            <button className="btn-action" onClick={CloseInstaller}>Close</button>
          </div>
        )}
      </div>

      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${progress}%`, transition: progress === 0 ? 'none' : 'width 0.25s ease' }} />
      </div>

    </div>
  )
}
