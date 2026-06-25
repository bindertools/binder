import React, { useEffect, useState } from 'react'
import { Install, GetChannel, GetInstallDir, GetReleases, LaunchAndClose, CloseInstaller, Ready } from '../wailsjs/go/main/App'
import { EventsOn } from '../wailsjs/runtime/runtime'
import { X, Check, Sparkles, GraduationCap, Code2, Database, Workflow, Network } from 'lucide-react'

type Phase = 'persona' | 'ready' | 'installing' | 'done'

type Persona = 'hobbyist' | 'student' | 'software' | 'data' | 'process' | 'network'

const PERSONAS: { id: Persona; label: string; blurb: string; icon: React.ElementType }[] = [
  { id: 'hobbyist', label: 'Hobbyist',          blurb: 'Just the essentials to start.',        icon: Sparkles },
  { id: 'student',  label: 'Student',           blurb: 'Adds Notepad for coursework notes.',   icon: GraduationCap },
  { id: 'software', label: 'Software Engineer', blurb: 'Adds Version Control and Workflows.',  icon: Code2 },
  { id: 'data',     label: 'Data Engineer',     blurb: 'Adds the Database app.',                icon: Database },
  { id: 'process',  label: 'Process Engineer',  blurb: 'Adds Workflows.',                       icon: Workflow },
  { id: 'network',  label: 'Network Engineer',  blurb: 'Adds Ports & Endpoints.',                icon: Network },
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
// A printed checklist, not a dropdown — every option is visible up front and
// exactly one is selectable at a time.
function VersionRow({ active, label, badge, date, onClick }: {
  active: boolean
  label:  string
  badge?: string
  date?:  string
  onClick: () => void
}) {
  return (
    <div className={`version-item${active ? ' active' : ''}`} onClick={onClick}>
      <span className="version-radio" />
      <span className="version-item-label">
        {label}
        {badge && <span className="version-badge">{badge}</span>}
      </span>
      {date && <span className="version-date">{date}</span>}
    </div>
  )
}

function VersionChecklist({ value, onChange, releases }: {
  value:    string
  onChange: (v: string) => void
  releases: Release[]
}) {
  // GitHub returns releases newest-first, so the first prerelease in the list
  // is the latest dev/pre-release build.
  const latestPrerelease = releases.find(r => r.prerelease)
  const olderReleases    = releases.filter(r => r !== latestPrerelease)

  return (
    <div className="version-list">
      <VersionRow
        active={value === 'latest'}
        label="Latest (stable)"
        onClick={() => onChange('latest')}
      />
      {latestPrerelease && (
        <VersionRow
          active={value === latestPrerelease.version}
          label="Latest (dev build)"
          badge="Snapshot"
          onClick={() => onChange(latestPrerelease.version)}
        />
      )}
      {olderReleases.length > 0 && (
        <div className="version-scroll">
          {olderReleases.map(r => (
            <VersionRow
              key={r.version}
              active={value === r.version}
              label={r.name || r.version}
              badge={r.prerelease ? 'Snapshot' : undefined}
              date={r.publishedAt}
              onClick={() => onChange(r.version)}
            />
          ))}
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
    // Signal the native host that the first frame has painted, so it can
    // reveal the (still-hidden) window without ever flashing default OS
    // chrome or losing focus to whatever launched it.
    Ready()

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
      <button className="btn-close" style={noDrag} onClick={CloseInstaller} title="Close">
        <X size={14} />
      </button>

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
            <button className="error-banner-dismiss" onClick={() => setErrorBanner('')}>
              <X size={12} />
            </button>
          </div>
        )}

        {/* ── SCREEN 0: Persona picker ── */}
        {phase === 'persona' && (
          <div className="screen-persona" style={noDrag}>
            <p className="persona-prompt">What are you?</p>
            <div className="persona-grid">
              {PERSONAS.map(p => {
                const Icon = p.icon
                return (
                  <button
                    key={p.id}
                    className={`persona-card${persona === p.id ? ' active' : ''}`}
                    onClick={() => setPersona(p.id)}
                  >
                    <span className="persona-card-icon"><Icon size={16} /></span>
                    <span className="persona-card-text">
                      <span className="persona-card-label">{p.label}</span>
                      <span className="persona-card-blurb">{p.blurb}</span>
                    </span>
                  </button>
                )
              })}
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
              <div className="version-section">
                <span className="field-label">Version</span>
                <VersionChecklist
                  value={version}
                  onChange={setVersion}
                  releases={releases}
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
            <div className="done-checkmark"><Check size={20} /></div>
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
