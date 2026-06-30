import React, { useEffect, useState, useCallback } from 'react'
import { Download, Trash2, RefreshCw, Search, Check, X } from 'lucide-react'
import type { AppManifest } from './types'
import { getAvailableAppIds, loadAppManifest } from './loader'
import { getInstalledIds, installApp, uninstallApp } from './registry'
import {
  fetchRemoteCatalog, loadRemoteBundle, invalidateRemoteBundle,
  getInstalledBundleVersion, setInstalledBundleVersion,
  type RemoteAppEntry, type RemoteThemeEntry,
} from './remoteRegistry'
import { THEMES } from '../themes'
import { invoke, isWebViewHost } from '../lib/ipc'
import './AppStore.scss'

type Tab = 'apps' | 'themes'
type AppFilter = 'all' | 'installed' | 'updates'

// ── Merged app entry (local bundled manifest + remote registry metadata) ────────
interface MergedApp {
  id: string
  manifest: AppManifest | null
  remote: RemoteAppEntry | null
  isInstalled: boolean
  hasUpdate: boolean
}

// ── Apps Tab ──────────────────────────────────────────────────────────────────

function AppsTab() {
  const [bundled, setBundled]     = useState<AppManifest[]>([])
  const [remote, setRemote]       = useState<RemoteAppEntry[]>([])
  const [installed, setInstalled] = useState<Set<string>>(new Set(getInstalledIds()))
  const [search, setSearch]       = useState('')
  const [filter, setFilter]       = useState<AppFilter>('all')
  const [loading, setLoading]     = useState(true)
  const [busy, setBusy]           = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false

    const loadBundled = Promise.all(getAvailableAppIds().map(loadAppManifest)).then(loaded => {
      if (!cancelled) setBundled(loaded.filter((m): m is AppManifest => m != null))
    })

    const loadRemote = fetchRemoteCatalog().then(catalog => {
      if (!cancelled && catalog) setRemote(catalog.apps)
    })

    void Promise.all([loadBundled, loadRemote]).finally(() => {
      if (!cancelled) setLoading(false)
    })

    return () => { cancelled = true }
  }, [])

  const merged = buildMerged(bundled, remote, installed)

  const filtered = merged.filter(a => {
    if (filter === 'installed' && !a.isInstalled) return false
    if (filter === 'updates' && !a.hasUpdate) return false
    if (search) {
      const q = search.toLowerCase()
      const name = (a.manifest?.name ?? a.remote?.name ?? '').toLowerCase()
      const desc = (a.manifest?.description ?? a.remote?.description ?? '').toLowerCase()
      if (!name.includes(q) && !desc.includes(q)) return false
    }
    return true
  })

  const updateCount = merged.filter(a => a.hasUpdate).length

  const handleToggle = useCallback(async (a: MergedApp) => {
    if (busy.has(a.id)) return
    setBusy(prev => new Set([...prev, a.id]))

    try {
      if (a.isInstalled) {
        await uninstallApp(a.id)
        invalidateRemoteBundle(a.id)
        setInstalled(prev => { const s = new Set(prev); s.delete(a.id); return s })
      } else {
        if (a.remote && !a.manifest) {
          // Remote-only app: download bundle first
          const manifest = await loadRemoteBundle(a.id, a.remote.bundleUrl)
          if (!manifest) { setBusy(prev => { const s = new Set(prev); s.delete(a.id); return s }); return }
          if (a.remote.version) setInstalledBundleVersion(a.id, a.remote.version)
        }
        await installApp(a.id)
        setInstalled(prev => new Set([...prev, a.id]))
      }
    } finally {
      setBusy(prev => { const s = new Set(prev); s.delete(a.id); return s })
    }
  }, [busy])

  const handleUpdate = useCallback(async (a: MergedApp) => {
    if (!a.remote || busy.has(a.id)) return
    setBusy(prev => new Set([...prev, a.id]))
    try {
      invalidateRemoteBundle(a.id)
      const manifest = await loadRemoteBundle(a.id, a.remote.bundleUrl)
      if (manifest && a.remote.version) {
        setInstalledBundleVersion(a.id, a.remote.version)
        // Trigger re-merge
        setInstalled(prev => new Set(prev))
      }
    } finally {
      setBusy(prev => { const s = new Set(prev); s.delete(a.id); return s })
    }
  }, [busy])

  return (
    <>
      <div className="ps-search-wrap">
        <span className="ps-search-icon"><Search size={13} aria-hidden /></span>
        <input
          className="ps-search"
          placeholder="Search apps…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {search && (
          <button className="ps-search-clear" onClick={() => setSearch('')}><X size={13} /></button>
        )}
      </div>

      <div className="ps-filter-row">
        <button className={`ps-filter-btn${filter === 'all' ? ' ps-filter-btn--active' : ''}`} onClick={() => setFilter('all')}>All</button>
        <button className={`ps-filter-btn${filter === 'installed' ? ' ps-filter-btn--active' : ''}`} onClick={() => setFilter('installed')}>
          Installed ({installed.size})
        </button>
        {updateCount > 0 && (
          <button className={`ps-filter-btn ps-filter-btn--updates${filter === 'updates' ? ' ps-filter-btn--active' : ''}`} onClick={() => setFilter('updates')}>
            Updates ({updateCount})
          </button>
        )}
      </div>

      {loading ? (
        <div className="ps-loading">
          <div className="ps-loading__spinner" />
          <span>Loading catalog…</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="ps-empty">
          {filter === 'updates' ? 'All apps are up to date.' : 'No apps match your search.'}
        </div>
      ) : (
        <div className="ps-grid">
          {filtered.map(a => (
            <AppCard
              key={a.id}
              app={a}
              isBusy={busy.has(a.id)}
              onToggle={handleToggle}
              onUpdate={handleUpdate}
            />
          ))}
        </div>
      )}
    </>
  )
}

interface AppCardProps {
  app: MergedApp
  isBusy: boolean
  onToggle: (a: MergedApp) => void
  onUpdate: (a: MergedApp) => void
}

function AppCard({ app, isBusy, onToggle, onUpdate }: AppCardProps) {
  const name    = app.manifest?.name    ?? app.remote?.name    ?? app.id
  const desc    = app.manifest?.description ?? app.remote?.description ?? ''
  const author  = app.manifest?.author  ?? app.remote?.author  ?? ''
  const version = app.manifest?.version ?? app.remote?.version ?? ''
  const icon    = app.manifest?.sidebar?.icon

  return (
    <div className={`ps-card${app.isInstalled ? ' ps-card--installed' : ''}${app.hasUpdate ? ' ps-card--has-update' : ''}`}>
      <div className="ps-card__top">
        <div className="ps-card__icon">
          {icon ? React.createElement(icon) : <span className="ps-card__icon-letter">{name.charAt(0)}</span>}
        </div>
        <div className="ps-card__identity">
          <div className="ps-card__name">{name}</div>
          <div className="ps-card__byline">
            <span>{author}</span>
            {version && <><span className="ps-card__dot">·</span><span>v{version}</span></>}
            {app.remote?.official && <span className="ps-chip ps-chip--official">official</span>}
          </div>
        </div>
        <div className="ps-card__actions">
          {app.hasUpdate && (
            <button
              className={`ps-card__gear ps-card__gear--update${isBusy ? ' ps-card__gear--loading' : ''}`}
              onClick={() => onUpdate(app)}
              title="Update"
              disabled={isBusy}
            >
              {isBusy ? <span className="ps-spin"><RefreshCw size={14} /></span> : <RefreshCw size={14} />}
            </button>
          )}
          <button
            className={`ps-card__gear${app.isInstalled ? ' ps-card__gear--installed' : ''}${isBusy ? ' ps-card__gear--loading' : ''}`}
            onClick={() => onToggle(app)}
            title={app.isInstalled ? 'Uninstall' : 'Install'}
            disabled={isBusy}
          >
            {isBusy
              ? <span className="ps-spin"><RefreshCw size={14} /></span>
              : app.isInstalled ? <Trash2 size={14} /> : <Download size={14} />
            }
          </button>
        </div>
      </div>
      {app.hasUpdate && (
        <div className="ps-update-badge">Update available</div>
      )}
      <p className="ps-card__desc">{desc}</p>
    </div>
  )
}

function buildMerged(
  bundled: AppManifest[],
  remote: RemoteAppEntry[],
  installed: Set<string>,
): MergedApp[] {
  const byId = new Map<string, MergedApp>()

  for (const m of bundled) {
    byId.set(m.id, { id: m.id, manifest: m, remote: null, isInstalled: installed.has(m.id), hasUpdate: false })
  }

  for (const r of remote) {
    const existing = byId.get(r.id)
    if (existing) {
      existing.remote = r
      // Check for update: registry version > locally installed bundle version
      const installedVersion = existing.manifest?.version ?? getInstalledBundleVersion(r.id)
      existing.hasUpdate = !!installedVersion && compareVersions(r.version, installedVersion) > 0
    } else {
      byId.set(r.id, { id: r.id, manifest: null, remote: r, isInstalled: installed.has(r.id), hasUpdate: false })
    }
  }

  return [...byId.values()]
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

// ── Themes Tab ────────────────────────────────────────────────────────────────

interface ThemesTabProps {
  activeTheme: string
  onApplyTheme: (id: string) => void
}

function ThemesTab({ activeTheme, onApplyTheme }: ThemesTabProps) {
  const [remoteThemes, setRemoteThemes] = useState<RemoteThemeEntry[]>([])

  useEffect(() => {
    void fetchRemoteCatalog().then(catalog => {
      if (catalog?.themes) setRemoteThemes(catalog.themes)
    })
  }, [])

  // Merge built-in THEMES with remote metadata
  const builtinIds = Object.keys(THEMES)
  const merged = builtinIds.map(id => {
    const remote = remoteThemes.find(t => t.id === id)
    return {
      id,
      name: remote?.name ?? id.charAt(0).toUpperCase() + id.slice(1),
      description: remote?.description ?? '',
      author: remote?.author ?? 'Binder',
      official: remote?.official ?? true,
      preview: remote?.preview ?? null,
      builtin: true,
    }
  })

  // Community themes from remote that are NOT built-in
  const community = remoteThemes.filter(t => !t.builtin && !builtinIds.includes(t.id))

  return (
    <>
      <div className="ps-section-label">Built-in Themes</div>
      <div className="ps-theme-grid">
        {merged.map(t => (
          <ThemeCard
            key={t.id}
            id={t.id}
            name={t.name}
            description={t.description}
            author={t.author}
            official={t.official}
            preview={t.preview}
            isActive={activeTheme === t.id}
            onApply={onApplyTheme}
          />
        ))}
      </div>

      {community.length > 0 && (
        <>
          <div className="ps-section-label ps-section-label--spaced">Community Themes</div>
          <div className="ps-theme-grid">
            {community.map(t => (
              <ThemeCard
                key={t.id}
                id={t.id}
                name={t.name}
                description={t.description}
                author={t.author}
                official={false}
                preview={t.preview ?? null}
                isActive={activeTheme === t.id}
                onApply={onApplyTheme}
              />
            ))}
          </div>
        </>
      )}
    </>
  )
}

interface ThemeCardProps {
  id: string
  name: string
  description: string
  author: string
  official: boolean
  preview: { bg: string; surface: string; border: string; text: string; accent: string } | null
  isActive: boolean
  onApply: (id: string) => void
}

function ThemeCard({ id, name, description, author, official, preview, isActive, onApply }: ThemeCardProps) {
  const localTheme = THEMES[id]
  const bg      = preview?.bg      ?? localTheme?.appBg       ?? '#1c1c1e'
  const surface = preview?.surface ?? localTheme?.infoBarBg   ?? '#2c2c2e'
  const border  = preview?.border  ?? localTheme?.borderColor ?? '#3a3a3c'
  const text    = preview?.text    ?? localTheme?.infoBarColor ?? '#888'
  const accent  = preview?.accent  ?? '#0a84ff'

  return (
    <div className={`ps-theme-card${isActive ? ' ps-theme-card--active' : ''}`}>
      <div className="ps-theme-card__preview" style={{ background: bg, borderColor: border }}>
        <div className="ps-theme-card__preview-bar" style={{ background: surface, borderBottomColor: border }}>
          <span style={{ background: accent, borderRadius: 2, width: 20, height: 4, display: 'block' }} />
          <span style={{ background: text, borderRadius: 2, width: 28, height: 4, display: 'block', opacity: 0.5 }} />
          <span style={{ background: text, borderRadius: 2, width: 18, height: 4, display: 'block', opacity: 0.3 }} />
        </div>
        <div className="ps-theme-card__preview-lines">
          {[40, 60, 45, 70].map((w, i) => (
            <span key={i} style={{ background: text, borderRadius: 2, width: `${w}%`, height: 3, display: 'block', opacity: 0.18 + i * 0.04 }} />
          ))}
        </div>
      </div>
      <div className="ps-theme-card__body">
        <div className="ps-theme-card__name">
          {name}
          {isActive && <span className="ps-theme-card__active-dot"><Check size={13} /></span>}
        </div>
        <div className="ps-theme-card__byline">
          <span>{author}</span>
          {official && <span className="ps-chip ps-chip--official">official</span>}
        </div>
        {description && <p className="ps-theme-card__desc">{description}</p>}
        {!isActive && (
          <button className="ps-theme-card__apply" onClick={() => onApply(id)}>Apply</button>
        )}
      </div>
    </div>
  )
}

// ── Root AppStore ─────────────────────────────────────────────────────────────

export default function AppStore() {
  const [tab, setTab] = useState<Tab>('apps')
  const [activeTheme, setActiveTheme] = useState(() => {
    // Read from data-theme attribute as best-effort before IPC resolves
    return document.documentElement.getAttribute('data-theme') ?? 'dark'
  })

  const handleApplyTheme = useCallback(async (id: string) => {
    setActiveTheme(id)
    window.dispatchEvent(new CustomEvent('binder:apply-theme', { detail: { theme: id } }))
    if (isWebViewHost()) {
      await invoke('config.set', { key: 'theme', value: id }).catch(() => {})
    }
  }, [])

  return (
    <div className="ps">
      <div className="ps__tabs">
        <button className={`ps__tab${tab === 'apps' ? ' ps__tab--active' : ''}`} onClick={() => setTab('apps')}>Apps</button>
        <button className={`ps__tab${tab === 'themes' ? ' ps__tab--active' : ''}`} onClick={() => setTab('themes')}>Themes</button>
      </div>

      <div className="ps__body">
        <div className="ps__center">
          {tab === 'apps'   && <AppsTab />}
          {tab === 'themes' && <ThemesTab activeTheme={activeTheme} onApplyTheme={handleApplyTheme} />}
        </div>
      </div>
    </div>
  )
}
