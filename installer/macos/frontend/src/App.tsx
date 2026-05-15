import React, { useEffect, useState } from 'react'
import { Install, GetInstallDir, LaunchAndClose, CloseInstaller } from '../wailsjs/go/main/App'
import { EventsOn } from '../wailsjs/runtime/runtime'

type Phase = 'ready' | 'installing' | 'done' | 'error'

const drag   = { '--wails-draggable': 'drag'    } as React.CSSProperties
const noDrag = { '--wails-draggable': 'no-drag' } as React.CSSProperties

export default function App() {
  const [phase,          setPhase]         = useState<Phase>('ready')
  const [progress,       setProgress]      = useState(0)
  const [statusMsg,      setStatusMsg]     = useState('')
  const [error,          setError]         = useState('')
  const [installDir,     setInstallDir]    = useState('')
  const [createShortcut,  setCreateShortcut]  = useState(true)
  const [installPlugins,  setInstallPlugins]  = useState(false)

  useEffect(() => {
    GetInstallDir().then(setInstallDir)
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
      await Install(createShortcut)
    } catch (e: unknown) {
      setError(String(e))
      setPhase('error')
    }
  }

  return (
    <div className="installer" style={drag}>

      <button className="btn-close" style={noDrag} onClick={CloseInstaller}>
        ✕
      </button>

      <div className="content">

        <div className="brand">
          <img
            src="/lockup-dark.svg"
            alt="cmdIDE"
            className="brand-lockup"
            draggable={false}
          />
        </div>

        {phase === 'ready' && (
          <div className="ready" style={noDrag}>
            <p className="install-dir-label">Installing to</p>
            <p className="install-dir-path">{installDir}</p>

            <div className="options">
              <label className="opt-row">
                <input
                  type="checkbox"
                  checked={createShortcut}
                  onChange={e => setCreateShortcut(e.target.checked)}
                />
                <span>Add to /usr/local/bin</span>
              </label>
              <label className="opt-row">
                <input
                  type="checkbox"
                  checked={installPlugins}
                  onChange={e => setInstallPlugins(e.target.checked)}
                />
                <span>Install Plugin Manager</span>
              </label>
            </div>

            <button className="btn-install" onClick={handleInstall}>
              Install
            </button>
          </div>
        )}

        {phase === 'installing' && (
          <div className="installing" style={noDrag}>
            <p className="status-msg">{statusMsg}</p>
            <p className="status-msg">{Math.max(0, Math.min(100, Math.round(progress)))}%</p>
          </div>
        )}

        {phase === 'done' && (
          <div className="done" style={noDrag}>
            <p className="status-msg success">Installed successfully</p>
            <div className="actions">
              <button className="btn-action btn-launch" onClick={LaunchAndClose}>
                Launch
              </button>
              <button className="btn-action" onClick={CloseInstaller}>
                Close
              </button>
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
        <div
          className="progress-fill"
          style={{ width: `${progress}%`, transition: progress === 0 ? 'none' : 'width 0.25s ease' }}
        />
      </div>

    </div>
  )
}
