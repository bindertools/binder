import React, { useEffect, useState } from 'react'
import type { AppManifest } from './types'
import { getAvailableAppIds, loadAppManifest } from './loader'
import { getInstalledIds, installApp, uninstallApp } from './registry'
import './AppStore.scss'

// No props: install/uninstall already broadcasts the binder:apps-changed event
// that drives the sidebar registry, so nothing needs to be passed back up.

function IconDownload() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7.5 2v8M4.5 7l3 3 3-3" />
      <path d="M2.5 12.5h10" />
    </svg>
  )
}

function IconTrash() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 4h10M6 4V3h3v1" />
      <path d="M3.5 4l.8 8h6.4l.8-8" />
    </svg>
  )
}

function IconSearch() {
  return (
    <svg width="13" height="13" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="6.5" cy="6.5" r="4.5"/>
      <path d="M10 10l3 3"/>
    </svg>
  )
}

export default function AppStore() {
  const [search,    setSearch]    = useState('')
  const [apps,       setApps]      = useState<AppManifest[]>([])
  const [installed, setInstalled] = useState<Set<string>>(new Set(getInstalledIds()))
  const [showInstalled, setShowInstalled] = useState(false)

  useEffect(() => {
    let cancelled = false
    void Promise.all(getAvailableAppIds().map(loadAppManifest)).then(loaded => {
      if (!cancelled) setApps(loaded.filter((m): m is AppManifest => m != null))
    })
    return () => { cancelled = true }
  }, [])

  const toggle = async (app: AppManifest) => {
    if (installed.has(app.id)) {
      await uninstallApp(app.id)
      setInstalled(prev => { const s = new Set(prev); s.delete(app.id); return s })
    } else {
      await installApp(app.id)
      setInstalled(prev => new Set([...prev, app.id]))
    }
  }

  const filtered = apps.filter(a => {
    if (showInstalled && !installed.has(a.id)) return false
    if (!search) return true
    const q = search.toLowerCase()
    return a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q)
  })

  return (
    <div className="ps">
      <div className="ps__body">
        <div className="ps__center">
          <div className="ps-search-wrap">
            <span className="ps-search-icon"><IconSearch /></span>
            <input
              className="ps-search"
              placeholder="Search apps…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button className="ps-search-clear" onClick={() => setSearch('')}>×</button>
            )}
          </div>

          <div className="ps-section">
            <div className="ps-section__controls">
              <button
                className={`ps-filter-btn${showInstalled ? ' ps-filter-btn--active' : ''}`}
                onClick={() => setShowInstalled(v => !v)}
              >
                Installed ({installed.size})
              </button>
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="ps-empty">No apps match your filters.</div>
          ) : (
            <div className="ps-grid">
              {filtered.map(app => {
                const isInst = installed.has(app.id)
                return (
                  <div key={app.id} className={`ps-card${isInst ? ' ps-card--installed' : ''}`}>
                    <div className="ps-card__top">
                      <div className="ps-card__icon">
                        {app.sidebar ? <app.sidebar.icon /> : null}
                      </div>
                      <div className="ps-card__identity">
                        <div className="ps-card__name">{app.name}</div>
                        <div className="ps-card__byline">
                          <span>{app.author}</span>
                          <span className="ps-card__dot">•</span>
                          <span>v{app.version}</span>
                          <span className="ps-chip ps-chip--official">official</span>
                        </div>
                      </div>
                      <button
                        className={`ps-card__gear${isInst ? ' ps-card__gear--installed' : ''}`}
                        onClick={() => void toggle(app)}
                        title={isInst ? 'Uninstall' : 'Install'}
                      >
                        {isInst ? <IconTrash /> : <IconDownload />}
                      </button>
                    </div>
                    <p className="ps-card__desc">{app.description}</p>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
