import React, { useState, useCallback } from 'react'
import { PLUGIN_DIRECTORY, DirectoryEntry, PluginCategory } from './directory'
import {
  getInstalledIds, installPlugin, uninstallPlugin,
  getExternalPlugins, saveExternalPlugin, removeExternalPlugin,
  ExternalPluginRecord,
} from './index'
import { FetchExternalPlugin } from '../../wailsjs/go/main/App'
import './PluginStore.css'

type StoreTab = 'browse' | 'external'

interface Props { tabId: string; active: boolean; onPluginChange: () => void }

const CATEGORY_ICONS: Record<PluginCategory | string, string> = {
  development:  '⌨',
  productivity: '◈',
  utilities:    '⚒',
  other:        '⊡',
}

function IconDownload() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7.5 2v8M4.5 7l3 3 3-3" />
      <path d="M2.5 12.5h10" />
    </svg>
  )
}

function IconSpinner() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="ps-spin">
      <path d="M7.5 1.5A6 6 0 1 1 1.5 7.5" />
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

function Chip({ label, variant }: { label: string; variant: 'official' | 'external' }) {
  return <span className={`ps-chip ps-chip--${variant}`}>{label}</span>
}

// ── Browse ────────────────────────────────────────────────────────────────────
function BrowseTab({ onPluginChange }: { onPluginChange: () => void }) {
  const [search,        setSearch]        = useState('')
  const [category,      setCategory]      = useState<PluginCategory | 'all'>('all')
  const [showInstalled, setShowInstalled] = useState(false)
  const [installed,     setInstalled]     = useState<Set<string>>(new Set(getInstalledIds()))
  const [fetching,      setFetching]      = useState<Set<string>>(new Set())
  const [fetchError,    setFetchError]    = useState<string | null>(null)

  const filtered = PLUGIN_DIRECTORY.filter(p => {
    if (showInstalled && !installed.has(p.id)) return false
    if (category !== 'all' && p.category !== category) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.tags.some(t => t.includes(q))
      )
    }
    return true
  })

  const toggle = async (entry: DirectoryEntry) => {
    if (installed.has(entry.id)) {
      uninstallPlugin(entry.id)
      removeExternalPlugin(entry.id)
      setInstalled(prev => { const s = new Set(prev); s.delete(entry.id); return s })
      onPluginChange()
    } else {
      setFetchError(null)
      setFetching(prev => new Set([...prev, entry.id]))
      try {
        const result = await FetchExternalPlugin(entry.githubUrl)
        const record: ExternalPluginRecord = {
          id:          result.id || entry.id,
          name:        result.name || entry.name,
          description: result.description || entry.description,
          author:      result.author || entry.author,
          version:     result.version || entry.version,
          githubUrl:   entry.githubUrl,
          code:        result.code,
        }
        saveExternalPlugin(record)
        installPlugin(entry.id)
        setInstalled(prev => new Set([...prev, entry.id]))
        onPluginChange()
      } catch (err: any) {
        setFetchError(`Failed to install ${entry.name}: ${err?.message ?? String(err)}`)
      } finally {
        setFetching(prev => { const s = new Set(prev); s.delete(entry.id); return s })
      }
    }
  }

  const CATEGORIES: { value: PluginCategory | 'all'; label: string }[] = [
    { value: 'all',          label: 'All' },
    { value: 'development',  label: 'Development' },
    { value: 'productivity', label: 'Productivity' },
    { value: 'utilities',    label: 'Utilities' },
    { value: 'other',        label: 'Other' },
  ]

  return (
    <div className="ps__center">
      <div className="ps-search-wrap">
        <span className="ps-search-icon">⌕</span>
        <input
          className="ps-search"
          placeholder="Search plugins…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {search && (
          <button className="ps-search-clear" onClick={() => setSearch('')}>×</button>
        )}
      </div>

      <div className="ps-section">
        <div className="ps-section__controls">
          {CATEGORIES.map(c => (
            <button
              key={c.value}
              className={`ps-filter-btn${category === c.value ? ' ps-filter-btn--active' : ''}`}
              onClick={() => setCategory(c.value)}
            >
              {c.label}
            </button>
          ))}
          <div className="ps-filter-divider" />
          <button
            className={`ps-filter-btn${showInstalled ? ' ps-filter-btn--active' : ''}`}
            onClick={() => setShowInstalled(v => !v)}
          >
            Installed ({installed.size})
          </button>
        </div>
      </div>

      {fetchError && (
        <div className="ps-ext__error" style={{ marginBottom: 12 }}>{fetchError}</div>
      )}

      {filtered.length === 0 ? (
        <div className="ps-empty">No plugins match your filters.</div>
      ) : (
        <div className="ps-grid">
          {filtered.map(entry => {
            const isInst  = installed.has(entry.id)
            const isFetch = fetching.has(entry.id)
            return (
              <div key={entry.id} className={`ps-card${isInst ? ' ps-card--installed' : ''}`}>
                <div className="ps-card__top">
                  <div className="ps-card__icon">
                    {CATEGORY_ICONS[entry.category] ?? '⊡'}
                  </div>
                  <div className="ps-card__identity">
                    <div className="ps-card__name">{entry.name}</div>
                    <div className="ps-card__byline">
                      <span>{entry.author}</span>
                      <span className="ps-card__dot">•</span>
                      <span>v{entry.version}</span>
                    </div>
                  </div>
                  <button
                    className={`ps-card__gear${isInst ? ' ps-card__gear--installed' : ''}${isFetch ? ' ps-card__gear--loading' : ''}`}
                    onClick={() => !isFetch && toggle(entry)}
                    title={isFetch ? 'Installing…' : isInst ? 'Uninstall' : 'Install'}
                    disabled={isFetch}
                  >
                    {isFetch ? <IconSpinner /> : isInst ? <IconTrash /> : <IconDownload />}
                  </button>
                </div>
                <p className="ps-card__desc">{entry.description}</p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── External ──────────────────────────────────────────────────────────────────
function ExternalTab({ onPluginChange }: { onPluginChange: () => void }) {
  const [url,    setUrl]    = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'success'>('idle')
  const [msg,    setMsg]    = useState('')
  const [exts,   setExts]   = useState<ExternalPluginRecord[]>(getExternalPlugins())

  const toSafeGithubUrl = (value: string): string | null => {
    try {
      const parsed = new URL(value.trim())
      const host = parsed.hostname.toLowerCase()
      if (parsed.protocol !== 'https:') return null
      if (host !== 'github.com' && host !== 'www.github.com') return null
      const parts = parsed.pathname.split('/').filter(Boolean)
      if (parts.length < 2) return null
      parsed.hash = ''
      return parsed.toString()
    } catch {
      return null
    }
  }

  const fetchAndInstall = useCallback(async () => {
    const safeGithubUrl = toSafeGithubUrl(url)
    if (!safeGithubUrl) {
      setMsg('Enter a valid GitHub repository URL (https://github.com/owner/repo).')
      setStatus('error')
      return
    }
    setStatus('loading')
    setMsg('')
    try {
      const result = await FetchExternalPlugin(safeGithubUrl)
      const record: ExternalPluginRecord = {
        id:          result.id,
        name:        result.name,
        description: result.description,
        author:      result.author,
        version:     result.version,
        githubUrl:   safeGithubUrl,
        code:        result.code,
      }
      saveExternalPlugin(record)
      installPlugin(record.id)
      setExts(getExternalPlugins())
      setUrl('')
      setStatus('success')
      setMsg(`"${record.name}" installed successfully.`)
      onPluginChange()
      setTimeout(() => setStatus('idle'), 4000)
    } catch (err: any) {
      setMsg(err?.message ?? String(err))
      setStatus('error')
    }
  }, [url, onPluginChange])

  const removeExt = (id: string) => {
    removeExternalPlugin(id)
    uninstallPlugin(id)
    setExts(getExternalPlugins())
    onPluginChange()
  }

  return (
    <div className="ps__center">
      <div className="ps-external">
        <div className="ps-ext__intro">
          <div className="ps-ext__title">Install from GitHub</div>
          <p className="ps-ext__desc">
            Paste the URL of any public GitHub repository built with the{' '}
            <a className="ps-link" href="https://github.com/cmdide/plugin-sdk" target="_blank" rel="noreferrer">
              CMD IDE Plugin SDK
            </a>. The repository must include a compiled <code>dist/index.js</code> bundle.
          </p>
        </div>

        <div className="ps-ext__form">
          <input
            className="ps-ext__input"
            placeholder="https://github.com/author/plugin-name"
            value={url}
            onChange={e => { setUrl(e.target.value); setStatus('idle') }}
            onKeyDown={e => e.key === 'Enter' && fetchAndInstall()}
            disabled={status === 'loading'}
          />
          <button
            className={`ps-btn ps-btn--fetch${status === 'loading' ? ' ps-btn--loading' : ''}`}
            onClick={fetchAndInstall}
            disabled={status === 'loading' || !url.trim()}
          >
            {status === 'loading' ? 'Fetching…' : 'Fetch & Install'}
          </button>
        </div>

        {status === 'error'   && <div className="ps-ext__error">{msg}</div>}
        {status === 'success' && <div className="ps-ext__success">{msg}</div>}

        <div className="ps-ext__reqs">
          <div className="ps-ext__reqs-title">Requirements</div>
          <ul className="ps-ext__reqs-list">
            <li>Repository must be <strong>public</strong> on GitHub</li>
            <li>Must include <code>dist/index.js</code> — a compiled ESM bundle that exports a <code>Plugin</code> object as its default export</li>
            <li>Must be built using the <a className="ps-link" href="https://github.com/cmdide/plugin-sdk" target="_blank" rel="noreferrer">CMD IDE Plugin SDK</a></li>
            <li>External plugins are <strong>not verified</strong> by the CMD IDE team — only install code you trust</li>
          </ul>
        </div>

        {exts.length > 0 && (
          <div>
            <div className="ps-ext__list-title">Installed external plugins</div>
            {exts.map(ext => (
              <div key={ext.id} className="ps-row">
                <div className="ps-row__info">
                  <div className="ps-row__name">
                    {ext.name}
                    <Chip label="external" variant="external" />
                  </div>
                  <div className="ps-row__meta">
                    {toSafeGithubUrl(ext.githubUrl) ? (
                      <a className="ps-link" href={toSafeGithubUrl(ext.githubUrl)!} target="_blank" rel="noreferrer">
                        {toSafeGithubUrl(ext.githubUrl)!.replace('https://github.com/', '')} ↗
                      </a>
                    ) : (
                      <span className="ps-muted">{ext.githubUrl}</span>
                    )}
                    <span className="ps-muted">v{ext.version}</span>
                  </div>
                </div>
                <button className="ps-btn ps-btn--remove" onClick={() => removeExt(ext.id)}>Remove</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Root ──────────────────────────────────────────────────────────────────────
export default function PluginStore({ onPluginChange }: Props) {
  const [tab, setTab] = useState<StoreTab>('browse')

  return (
    <div className="ps">
      <nav className="ps__nav">
        {(['browse', 'external'] as StoreTab[]).map(t => (
          <button
            key={t}
            className={`ps__nav-btn${tab === t ? ' ps__nav-btn--active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>
      <div className="ps__body">
        {tab === 'browse'   && <BrowseTab   onPluginChange={onPluginChange} />}
        {tab === 'external' && <ExternalTab onPluginChange={onPluginChange} />}
      </div>
    </div>
  )
}
