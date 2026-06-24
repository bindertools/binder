import React, { useEffect, useRef, useState } from 'react'
import { Install, GetChannel, GetInstallDir, GetReleases, LaunchAndClose, CloseInstaller } from '../wailsjs/go/main/App'
import { EventsOn } from '../wailsjs/runtime/runtime'

type Phase = 'persona' | 'ready' | 'installing' | 'done'

type Persona = 'hobbyist' | 'student' | 'software' | 'data' | 'process' | 'network'

const PERSONAS: { id: Persona; label: string; blurb: string }[] = [
  { id: 'hobbyist', label: 'Hobbyist',          blurb: 'Just the essentials to start.' },
  { id: 'student',  label: 'Student',           blurb: 'Adds Notepad for coursework notes.' },
  { id: 'software', label: 'Software Engineer', blurb: 'Adds Version Control and Workflows.' },
  { id: 'data',     label: 'Data Engineer',     blurb: 'Adds the Database app.' },
  { id: 'process',  label: 'Process Engineer',  blurb: 'Adds Workflows.' },
  { id: 'network',  label: 'Network Engineer',  blurb: 'Adds Ports & Endpoints.' },
]

// Which non-essential apps to pre-install for each persona. Terminal, Code
// Editor, and Debug always ship regardless of this choice. This selection is
// never stored or transmitted anywhere beyond seeding the local install.
const PERSONA_APPS: Record<Persona, string[]> = {
  hobbyist: [],
  student:  ['notepad'],
  software: ['versioncontrol', 'workflows'],
  data:     ['database'],
  process:  ['workflows'],
  network:  ['ports'],
}

interface Release {
  version:      string
  name:         string
  publishedAt:  string
  prerelease:   boolean
  downloadURL:  string
  releaseNotes: string
}

const drag   = { '--wails-draggable': 'drag'    } as React.CSSProperties
const noDrag = { '--wails-draggable': 'no-drag' } as React.CSSProperties

// ── Version picker ────────────────────────────────────────────────────────────
function VersionSelect({ value, onChange, releases, disabled }: {
  value:    string
  onChange: (v: string) => void
  releases: Release[]
  disabled: boolean
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

  const selected = releases.find(r => r.version === value)
  const label    = selected ? (selected.name || selected.version) : 'Latest (stable)'

  // GitHub returns releases newest-first, so the first prerelease in the list
  // is the latest dev/pre-release build.
  const latestPrerelease = releases.find(r => r.prerelease)
  const olderReleases     = releases.filter(r => r !== latestPrerelease)

  return (
    <div className="vsel" ref={ref}>
      <button
        className="vsel-btn"
        data-open={String(open)}
        disabled={disabled}
        onClick={() => !disabled && setOpen(o => !o)}
      >
        <span className="vsel-btn-label">
          {label}
          {selected?.prerelease && <span className="vsel-snapshot"> ⚠ Snapshot</span>}
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
            <span>Latest (stable)</span>
          </div>
          {latestPrerelease && (
            <div
              className={`vsel-item${value === latestPrerelease.version ? ' active' : ''} vsel-item--pre`}
              onClick={() => { onChange(latestPrerelease.version); setOpen(false) }}
            >
              <span className="vsel-item-label">
                Latest (dev build)
                <span className="vsel-badge">Snapshot</span>
              </span>
            </div>
          )}
          <div className="vsel-divider" />
          <div className="vsel-scroll">
            {olderReleases.map(r => (
              <div
                key={r.version}
                className={`vsel-item${value === r.version ? ' active' : ''}${r.prerelease ? ' vsel-item--pre' : ''}`}
                onClick={() => { onChange(r.version); setOpen(false) }}
              >
                <span className="vsel-item-label">
                  {r.name || r.version}
                  {r.prerelease && <span className="vsel-badge">Snapshot</span>}
                </span>
                {r.publishedAt && <span className="vsel-date">{r.publishedAt}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Root component ────────────────────────────────────────────────────────────
export default function App() {
  const [phase,          setPhase]         = useState<Phase>('persona')
  const [persona,        setPersona]       = useState<Persona | null>(null)
  const [progress,       setProgress]      = useState(0)
  const [statusMsg,      setStatusMsg]     = useState('')
  const [errorBanner,    setErrorBanner]   = useState('')
  const [installDir,     setInstallDir]    = useState('')
  const [channel,        setChannel]       = useState('stable')
  const [createShortcut, setCreateShortcut]= useState(true)
  const [version,        setVersion]       = useState('latest')
  const [releases,       setReleases]      = useState<Release[]>([])

  useEffect(() => {
    GetInstallDir().then(setInstallDir)
    GetChannel().then(setChannel)
    GetReleases().then(list => { if (list?.length) setReleases(list) })

    EventsOn('install:progress', (pct: number, msg: string) => {
      setProgress(pct)
      setStatusMsg(msg)
      if (pct >= 100) setPhase('done')
    })

    EventsOn('installer:error', (msg: string) => {
      setErrorBanner(msg)
    })
  }, [])

  const handleInstall = async () => {
    setErrorBanner('')
    setPhase('installing')
    setProgress(0)
    setStatusMsg('Starting…')
    try {
      await Install(version, createShortcut, persona ? PERSONA_APPS[persona] : [])
    } catch (e: unknown) {
      // Install() returned an error — backend already emits installer:error,
      // but fall back to showing it in the banner.
      setErrorBanner(String(e))
      setPhase('ready')
      setProgress(0)
    }
  }

  return (
    <div className="installer" style={drag}>

      {/* ── window chrome ── */}
      <button className="btn-close" style={noDrag} onClick={CloseInstaller} title="Close">✕</button>

      {/* ── main content area ── */}
      <div className="content">

        {/* brand + channel badge */}
        <div className="brand" style={noDrag}>
          <img src="/lockup-dark.svg" alt="Binder" className="brand-lockup" draggable={false} />
          {channel === 'dev' && <span className="channel-badge">Developer Channel</span>}
        </div>

        {/* ── error banner (persists across phases until dismissed) ── */}
        {errorBanner && (
          <div className="error-banner" style={noDrag}>
            <span>{errorBanner}</span>
            <button className="error-banner-dismiss" onClick={() => setErrorBanner('')}>✕</button>
          </div>
        )}

        {/* ── SCREEN 0: Persona picker ── */}
        {phase === 'persona' && (
          <div className="screen-persona" style={noDrag}>
            <p className="persona-prompt">What are you?</p>
            <div className="persona-grid">
              {PERSONAS.map(p => (
                <button
                  key={p.id}
                  className={`persona-card${persona === p.id ? ' active' : ''}`}
                  onClick={() => setPersona(p.id)}
                >
                  <span className="persona-card-label">{p.label}</span>
                  <span className="persona-card-blurb">{p.blurb}</span>
                </button>
              ))}
            </div>
            <button
              className="btn-install"
              disabled={!persona}
              onClick={() => setPhase('ready')}
            >
              Next
            </button>
          </div>
        )}

        {/* ── SCREEN 1: Welcome / picker ── */}
        {phase === 'ready' && (
          <div className="screen-ready" style={noDrag}>
            <div className="install-dir-row">
              <span className="field-label">Installing to</span>
              <span className="install-dir-path">{installDir}</span>
            </div>

            {releases.length > 0 && (
              <div className="version-row">
                <span className="field-label">Version</span>
                <VersionSelect
                  value={version}
                  onChange={setVersion}
                  releases={releases}
                  disabled={false}
                />
              </div>
            )}

            <div className="options">
              <label className="opt-row">
                <input
                  type="checkbox"
                  checked={createShortcut}
                  onChange={e => setCreateShortcut(e.target.checked)}
                />
                <span>Desktop shortcut</span>
              </label>
            </div>

            <button className="btn-install" onClick={handleInstall}>Install</button>
          </div>
        )}

        {/* ── SCREEN 2: Installing ── */}
        {phase === 'installing' && (
          <div className="screen-installing" style={noDrag}>
            <p className="installing-msg">{statusMsg || 'Working…'}</p>
            <div className="progress-bar-large">
              <div
                className="progress-bar-large-fill"
                style={{
                  width: `${progress}%`,
                  transition: progress === 0 ? 'none' : 'width 0.25s ease',
                }}
              />
            </div>
            <p className="progress-pct">{progress}%</p>
          </div>
        )}

        {/* ── SCREEN 3: Complete ── */}
        {phase === 'done' && (
          <div className="screen-done" style={noDrag}>
            <div className="done-checkmark">✓</div>
            <p className="done-title">Installation complete</p>
            <p className="done-sub">Binder was installed to your system.</p>
            <div className="done-actions">
              <button className="btn-action btn-launch" onClick={LaunchAndClose}>
                Launch Binder
              </button>
              <button className="btn-action" onClick={CloseInstaller}>
                Close
              </button>
            </div>
          </div>
        )}

      </div>

      {/* ── bottom progress strip (always visible during install) ── */}
      <div className="progress-track">
        <div
          className="progress-fill"
          style={{
            width: `${progress}%`,
            transition: progress === 0 ? 'none' : 'width 0.25s ease',
          }}
        />
      </div>

    </div>
  )
}
