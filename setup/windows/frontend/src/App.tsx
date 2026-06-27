import React, { useEffect, useState } from 'react'
import { Install, GetChannel, GetInstallDir, GetReleases, LaunchAndClose, CloseInstaller, Ready, EventsOn, type Release } from './lib/api'
import { X, Check, GraduationCap, Code2, Database, Workflow, Network } from 'lucide-react'

type Phase = 'persona' | 'configure' | 'installing' | 'done'

type Persona = 'student' | 'software' | 'data' | 'process' | 'network'

const PERSONAS: { id: Persona; label: string; blurb: string; icon: React.ElementType }[] = [
  { id: 'student',  label: 'Student',           blurb: 'Adds Notepad for coursework notes.',  icon: GraduationCap },
  { id: 'software', label: 'Software Engineer', blurb: 'Adds Version Control and Workflows.', icon: Code2 },
  { id: 'data',     label: 'Data Engineer',     blurb: 'Adds the Database app.',               icon: Database },
  { id: 'process',  label: 'Process Engineer',  blurb: 'Adds Workflows.',                      icon: Workflow },
  { id: 'network',  label: 'Network Engineer',  blurb: 'Adds Ports & Endpoints.',              icon: Network },
]

// Which non-essential apps to pre-install for each persona. Terminal, Code
// Editor, and Debug always ship regardless of this choice. This selection is
// never stored or transmitted anywhere beyond seeding the local install.
const PERSONA_APPS: Record<Persona, string[]> = {
  student:  ['notepad'],
  software: ['versioncontrol', 'workflows'],
  data:     ['database'],
  process:  ['workflows'],
  network:  ['ports'],
}

const STEPS: { key: Phase; label: string }[] = [
  { key: 'persona',    label: 'Profile'   },
  { key: 'configure',  label: 'Configure' },
  { key: 'installing', label: 'Install'   },
]

// ── shared row used for both the persona list and the version list ───────────
function SelectRow({ active, icon, title, subtitle, meta, onClick }: {
  active:    boolean
  icon?:     React.ReactNode
  title:     React.ReactNode
  subtitle?: string
  meta?:     React.ReactNode
  onClick:   () => void
}) {
  return (
    <button type="button" className={`select-row${active ? ' is-active' : ''}`} onClick={onClick}>
      {icon && <span className="select-row-icon">{icon}</span>}
      <span className="select-row-body">
        <span className="select-row-title">{title}</span>
        {subtitle && <span className="select-row-subtitle">{subtitle}</span>}
      </span>
      {meta}
      <span className="select-row-dot" aria-hidden="true" />
    </button>
  )
}

// ── persona grid (block cards, blue-border selection) ─────────────────────────
function PersonaGrid({ value, onChange }: {
  value:    Persona | null
  onChange: (p: Persona) => void
}) {
  return (
    <div className="persona-grid">
      {PERSONAS.map(p => (
        <button
          key={p.id}
          type="button"
          className={`persona-card${value === p.id ? ' is-active' : ''}`}
          onClick={() => onChange(p.id)}
        >
          <span className="persona-card-icon"><p.icon size={18} /></span>
          <span className="persona-card-label">{p.label}</span>
          <span className="persona-card-blurb">{p.blurb}</span>
        </button>
      ))}
    </div>
  )
}

function VersionList({ value, onChange, releases }: {
  value:    string
  onChange: (v: string) => void
  releases: Release[]
}) {
  // GitHub returns releases newest-first, so the first prerelease in the list
  // is the latest dev/pre-release build.
  const latestPrerelease = releases.find(r => r.prerelease)
  const olderReleases    = releases.filter(r => r !== latestPrerelease)

  return (
    <div className="select-list select-list--compact">
      <SelectRow
        active={value === 'latest'}
        title="Latest (stable)"
        onClick={() => onChange('latest')}
      />
      {latestPrerelease && (
        <SelectRow
          active={value === latestPrerelease.version}
          title="Latest (dev build)"
          meta={<span className="tag">Snapshot</span>}
          onClick={() => onChange(latestPrerelease.version)}
        />
      )}
      {olderReleases.length > 0 && (
        <div className="select-list-scroll">
          {olderReleases.map(r => (
            <SelectRow
              key={r.version}
              active={value === r.version}
              title={r.name || r.version}
              meta={<>
                {r.prerelease && <span className="tag">Snapshot</span>}
                {r.publishedAt && <span className="select-row-date">{r.publishedAt}</span>}
              </>}
              onClick={() => onChange(r.version)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function Stepper({ phase }: { phase: Phase }) {
  if (phase === 'done') return null
  const idx = STEPS.findIndex(s => s.key === phase)
  return (
    <div className="stepper">
      {STEPS.map((s, i) => (
        <div key={s.key} className={`stepper-item${i === idx ? ' is-current' : ''}${i < idx ? ' is-done' : ''}`}>
          <span className="stepper-dot" />
          <span className="stepper-label">{s.label}</span>
        </div>
      ))}
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
      setPhase('configure')
      setProgress(0)
    }
  }

  return (
    <div className="setup-app">

      <header className="setup-titlebar">
        <div className="setup-brand">
          <img src="/logo-dark.svg" alt="" className="setup-brand-mark" draggable={false} />
          <span className="setup-brand-name">Binder Setup</span>
          {channel === 'dev' && <span className="setup-channel-badge">Dev</span>}
        </div>
        <button className="setup-close" onClick={CloseInstaller} title="Close">
          <X size={14} />
        </button>
      </header>

      {errorBanner && (
        <div className="setup-alert">
          <span>{errorBanner}</span>
          <button className="setup-alert-dismiss" onClick={() => setErrorBanner('')}>
            <X size={12} />
          </button>
        </div>
      )}

      <Stepper phase={phase} />

      <main className="setup-body">

        {phase === 'persona' && (
          <section className="setup-section">
            <h1 className="setup-section-title">What best describes you?</h1>
            <p className="setup-section-hint">
              We'll pre-install a few extra apps that fit your workflow. You can change this later.
            </p>
            <PersonaGrid value={persona} onChange={setPersona} />
          </section>
        )}

        {phase === 'configure' && (
          <section className="setup-section">
            <div className="setup-field">
              <span className="setup-field-label">Install location</span>
              <span className="setup-field-value">{installDir}</span>
            </div>

            {releases.length > 0 && (
              <div className="setup-field">
                <span className="setup-field-label">Version</span>
                <VersionList value={version} onChange={setVersion} releases={releases} />
              </div>
            )}

            <label className="switch-row">
              <span className="switch-row-text">
                <span className="switch-row-title">Desktop shortcut</span>
                <span className="switch-row-desc">Add a shortcut to your desktop</span>
              </span>
              <span className="switch">
                <input
                  type="checkbox"
                  checked={createShortcut}
                  onChange={e => setCreateShortcut(e.target.checked)}
                />
                <span className="switch-track"><span className="switch-thumb" /></span>
              </span>
            </label>
          </section>
        )}

        {phase === 'installing' && (
          <section className="setup-section setup-section--center">
            <p className="setup-status">{statusMsg || 'Working…'}</p>
            <div className="progress-bar">
              <div
                className="progress-bar-fill"
                style={{
                  width: `${progress}%`,
                  transition: progress === 0 ? 'none' : 'width 0.25s ease',
                }}
              />
            </div>
            <p className="setup-status-pct">{progress}%</p>
          </section>
        )}

        {phase === 'done' && (
          <section className="setup-section setup-section--center">
            <div className="done-badge"><Check size={22} /></div>
            <h1 className="setup-section-title">Installation complete</h1>
            <p className="setup-section-hint">Binder was installed to your system.</p>
          </section>
        )}

      </main>

      <footer className="setup-footer">
        <div className="setup-footer-hint">
          {phase === 'persona' && !persona && 'Choose one to continue'}
          {phase === 'installing' && 'Please wait…'}
        </div>
        <div className="setup-footer-actions">
          {phase === 'persona' && (
            <button className="btn btn-primary" disabled={!persona} onClick={() => setPhase('configure')}>
              Next
            </button>
          )}
          {phase === 'configure' && (
            <>
              <button className="btn btn-ghost" onClick={() => setPhase('persona')}>Back</button>
              <button className="btn btn-primary" onClick={handleInstall}>Install</button>
            </>
          )}
          {phase === 'done' && (
            <>
              <button className="btn btn-ghost" onClick={CloseInstaller}>Close</button>
              <button className="btn btn-primary" onClick={LaunchAndClose}>Launch Binder</button>
            </>
          )}
        </div>
      </footer>

    </div>
  )
}
