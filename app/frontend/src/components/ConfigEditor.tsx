import React, { useState, useCallback, useEffect, useRef } from 'react'
import {
  THEMES,
  COLOR_SECTIONS,
  ANSI_PAIRS,
  themeToCustomColors,
} from '../themes'
import { AppConfig } from '../types'
import { SelectDirectory } from '../../wailsjs/go/main/App'
import './ConfigEditor.css'

interface Props {
  appConfig:       AppConfig
  onSaveSettings:  (cfg: AppConfig) => Promise<void>
  onApply:         (colors: Record<string, string>) => void
  onSaveTheme:     (colors: Record<string, string>) => Promise<void>
}

// ── helpers ────────────────────────────────────────────────────────────────────

const PRESET_KEYS = Object.keys(THEMES)

const ZOOM_OPTIONS = [
  { label: '1×',    value: 1.0  },
  { label: '1.1×',  value: 1.1  },
  { label: '1.25×', value: 1.25 },
  { label: '1.5×',  value: 1.5  },
  { label: '1.75×', value: 1.75 },
  { label: '2×',    value: 2.0  },
]

function seedColors(theme: string, saved: Record<string, string>): Record<string, string> {
  if (theme === 'custom' && Object.keys(saved).length > 0) return { ...saved }
  const preset = THEMES[theme] ?? THEMES['dark']
  return themeToCustomColors(preset)
}

// ── component ──────────────────────────────────────────────────────────────────

export default function ConfigEditor({ appConfig, onSaveSettings, onApply, onSaveTheme }: Props) {

  // ── Left panel: settings state ───────────────────────────────────────────────
  const [cfg, setCfg] = useState<AppConfig>({ ...appConfig })
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsMsg, setSettingsMsg] = useState<'idle' | 'saved' | 'error'>('idle')

  // ── Right panel: color state ─────────────────────────────────────────────────
  const [colors, setColors] = useState<Record<string, string>>(
    () => seedColors(appConfig.theme, appConfig.custom_theme ?? {}),
  )
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(['shell', 'terminal', 'editor', 'syntax']),
  )
  const [themeSaving, setThemeSaving] = useState(false)
  const [themeMsg,    setThemeMsg]    = useState<'idle' | 'saved' | 'error'>('idle')

  // Sync when config prop changes externally (e.g. after save or config reload)
  useEffect(() => { setCfg({ ...appConfig }) }, [appConfig])
  useEffect(() => {
    if (appConfig.theme === 'custom' && Object.keys(appConfig.custom_theme ?? {}).length > 0) {
      setColors({ ...appConfig.custom_theme! })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appConfig.custom_theme])

  // ── Left panel handlers ───────────────────────────────────────────────────────

  const handleToggle = (key: keyof AppConfig) =>
    setCfg(prev => ({ ...prev, [key]: !prev[key as keyof AppConfig] }))

  const handleGitToggle = () =>
    setCfg(prev => ({
      ...prev,
      git_recognition: { show_git_branch: !prev.git_recognition.show_git_branch },
    }))

  const handlePresetChange = (key: string) => {
    setCfg(prev => ({ ...prev, theme: key }))
    if (key === 'custom') {
      const saved = appConfig.custom_theme ?? {}
      if (Object.keys(saved).length > 0) {
        const c = { ...saved }
        setColors(c)
        onApply(c)
      }
    } else if (THEMES[key]) {
      const c = themeToCustomColors(THEMES[key])
      setColors(c)
      onApply(c)
    }
  }

  const handleBrowseDir = async () => {
    const dir = await SelectDirectory().catch(() => '')
    if (dir) setCfg(prev => ({ ...prev, default_directory: dir }))
  }

  const handleSaveSettings = async () => {
    setSettingsSaving(true)
    try {
      await onSaveSettings(cfg)
      setSettingsMsg('saved')
      setTimeout(() => setSettingsMsg('idle'), 2500)
    } catch {
      setSettingsMsg('error')
      setTimeout(() => setSettingsMsg('idle'), 3000)
    } finally {
      setSettingsSaving(false)
    }
  }

  // ── Right panel handlers ──────────────────────────────────────────────────────

  const handleColorChange = useCallback((key: string, val: string) => {
    setColors(prev => {
      const next = { ...prev, [key]: val }
      onApply(next)
      return next
    })
    setCfg(prev => ({ ...prev, theme: 'custom' }))
    setThemeMsg('idle')
  }, [onApply])

  const handleSaveTheme = async () => {
    setThemeSaving(true)
    try {
      await onSaveTheme(colors)
      setThemeMsg('saved')
      setTimeout(() => setThemeMsg('idle'), 2500)
    } catch {
      setThemeMsg('error')
      setTimeout(() => setThemeMsg('idle'), 3000)
    } finally {
      setThemeSaving(false)
    }
  }

  const handleExport = () => {
    const json = JSON.stringify(colors, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = 'cmdide-theme.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = () => {
    const input   = document.createElement('input')
    input.type    = 'file'
    input.accept  = '.json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const text   = await file.text()
        const parsed = JSON.parse(text) as Record<string, string>
        setColors(parsed)
        onApply(parsed)
        setCfg(prev => ({ ...prev, theme: 'custom' }))
      } catch { /* ignore bad files */ }
    }
    input.click()
  }

  const toggleSection = (id: string) =>
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  // ── Button labels ─────────────────────────────────────────────────────────────
  const settingsLabel =
    settingsSaving          ? 'Saving…'  :
    settingsMsg === 'saved' ? '✓ Saved'  :
    settingsMsg === 'error' ? '✕ Error'  :
    'Save Settings'

  const themeLabel =
    themeSaving          ? 'Saving…'       :
    themeMsg === 'saved' ? '✓ Saved'       :
    themeMsg === 'error' ? '✕ Error'       :
    'Save Custom Theme'

  // Is the currently active theme "custom" (from editing or selection)?
  const isCustom = cfg.theme === 'custom'

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="ce-root">

      {/* ── LEFT PANEL ────────────────────────────────────────────────────────── */}
      <div className="ce-left">
        <div className="ce-panel-header">
          <span className="ce-panel-title">Settings</span>
        </div>

        <div className="ce-left-body">

          {/* Theme preset */}
          <div className="ce-group">
            <div className="ce-group-label">Theme</div>
            <select
              className="ce-select"
              value={cfg.theme}
              onChange={e => handlePresetChange(e.target.value)}
            >
              {PRESET_KEYS.map(k => (
                <option key={k} value={k}>{k}</option>
              ))}
              <option value="custom">custom {isCustom ? '●' : ''}</option>
            </select>
          </div>

          {/* Default directory */}
          <div className="ce-group">
            <div className="ce-group-label">Default Directory</div>
            <div className="ce-dir-row">
              <input
                className="ce-text-input"
                type="text"
                value={cfg.default_directory}
                placeholder="e.g. C:\Projects"
                spellCheck={false}
                onChange={e => setCfg(prev => ({ ...prev, default_directory: e.target.value }))}
              />
              <button className="ce-btn ce-btn--ghost ce-btn--sm" onClick={handleBrowseDir} title="Browse">
                …
              </button>
            </div>
          </div>

          {/* Default zoom */}
          <div className="ce-group">
            <div className="ce-group-label">Default Zoom</div>
            <select
              className="ce-select"
              value={cfg.default_zoom}
              onChange={e => setCfg(prev => ({ ...prev, default_zoom: parseFloat(e.target.value) }))}
            >
              {ZOOM_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div className="ce-divider" />

          {/* Boolean toggle rows */}
          {([
            ['indent_guides',      'Indent Guides'],
            ['minimap',            'Minimap'],
            ['file_word_wrap',     'File Word Wrap'],
            ['terminal_word_wrap', 'Terminal Word Wrap'],
            ['show_timestamps',    'Show Timestamps'],
            ['minimal_pwd',        'Minimal PWD'],
            ['zoom_insights',      'Zoom Insights'],
            ['soft_close',         'Soft Close'],
            ['order_directory',    'Order Directory'],
          ] as [keyof AppConfig, string][]).map(([key, label]) => (
            <div key={key} className="ce-toggle-row">
              <span className="ce-toggle-label">{label}</span>
              <button
                role="switch"
                aria-checked={!!cfg[key]}
                className={`ce-toggle${cfg[key] ? ' is-on' : ''}`}
                onClick={() => handleToggle(key)}
              >
                <span className="ce-toggle-knob" />
              </button>
            </div>
          ))}

          {/* Git branch toggle */}
          <div className="ce-toggle-row">
            <span className="ce-toggle-label">Git Branch in Prompt</span>
            <button
              role="switch"
              aria-checked={cfg.git_recognition.show_git_branch}
              className={`ce-toggle${cfg.git_recognition.show_git_branch ? ' is-on' : ''}`}
              onClick={handleGitToggle}
            >
              <span className="ce-toggle-knob" />
            </button>
          </div>

        </div>{/* end ce-left-body */}

        <div className="ce-left-footer">
          <button
            className={`ce-btn ce-btn--primary${settingsMsg === 'saved' ? ' is-saved' : ''}${settingsMsg === 'error' ? ' is-error' : ''}`}
            onClick={handleSaveSettings}
            disabled={settingsSaving}
          >
            {settingsLabel}
          </button>
        </div>
      </div>{/* end ce-left */}

      {/* ── PANEL DIVIDER ─────────────────────────────────────────────────────── */}
      <div className="ce-panel-sep" />

      {/* ── RIGHT PANEL ───────────────────────────────────────────────────────── */}
      <div className="ce-right">
        <div className="ce-panel-header">
          <span className="ce-panel-title">Custom Colors</span>
          <div className="ce-panel-header-spacer" />
          <button className="ce-btn ce-btn--ghost" onClick={handleImport} title="Import theme JSON">
            Import
          </button>
          <button className="ce-btn ce-btn--ghost" onClick={handleExport} title="Export theme JSON">
            Export
          </button>
        </div>

        <div className="ce-right-body">
          {COLOR_SECTIONS.map(section => (
            <div key={section.id} className="ce-section">
              <button
                className="ce-section-head"
                onClick={() => toggleSection(section.id)}
              >
                <span className="ce-chevron">{expanded.has(section.id) ? '▾' : '▸'}</span>
                <span className="ce-section-label">{section.label}</span>
                <span className="ce-section-count">{section.items.length} colors</span>
              </button>

              {expanded.has(section.id) && (
                <div className="ce-section-body">
                  {section.items.map(spec => (
                    <ColorRow
                      key={spec.key}
                      label={spec.label}
                      colorKey={spec.key}
                      value={colors[spec.key] ?? '#000000'}
                      onChange={handleColorChange}
                    />
                  ))}

                  {/* ANSI grid injected into the terminal section */}
                  {section.id === 'terminal' && (
                    <div className="ce-ansi">
                      <div className="ce-ansi-title">ANSI Colors</div>
                      <div className="ce-ansi-col-head">
                        <span />
                        <span>Normal</span>
                        <span>Bright</span>
                      </div>
                      {ANSI_PAIRS.map(pair => (
                        <div key={pair.label} className="ce-ansi-row">
                          <span className="ce-ansi-label">{pair.label}</span>
                          <ColorSwatch
                            colorKey={pair.normal}
                            value={colors[pair.normal] ?? '#000000'}
                            onChange={handleColorChange}
                          />
                          <ColorSwatch
                            colorKey={pair.bright}
                            value={colors[pair.bright] ?? '#666666'}
                            onChange={handleColorChange}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          <div className="ce-footer-pad" />
        </div>

        <div className="ce-right-footer">
          <button
            className={`ce-btn ce-btn--primary${themeMsg === 'saved' ? ' is-saved' : ''}${themeMsg === 'error' ? ' is-error' : ''}`}
            onClick={handleSaveTheme}
            disabled={themeSaving}
          >
            {themeLabel}
          </button>
        </div>
      </div>{/* end ce-right */}

    </div>
  )
}

// ── ColorRow ───────────────────────────────────────────────────────────────────

interface ColorRowProps {
  label:    string
  colorKey: string
  value:    string
  onChange: (key: string, val: string) => void
}

function ColorRow({ label, colorKey, value, onChange }: ColorRowProps) {
  const nativeRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState(value)

  useEffect(() => { setText(value) }, [value])

  return (
    <div className="ce-color-row">
      <span className="ce-color-label">{label}</span>
      <div className="ce-color-ctrl">
        <div
          className="ce-swatch"
          style={{ background: value }}
          onClick={() => nativeRef.current?.click()}
          title="Click to open colour picker"
        />
        <input
          ref={nativeRef}
          type="color"
          value={value}
          onChange={e => onChange(colorKey, e.target.value)}
          className="ce-native-picker"
        />
        <input
          type="text"
          className="ce-hex-input"
          value={text}
          spellCheck={false}
          maxLength={7}
          onChange={e => setText(e.target.value)}
          onBlur={() => {
            const v = text.trim()
            if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(colorKey, v)
            else setText(value)
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
        />
      </div>
    </div>
  )
}

// ── ColorSwatch (compact, for ANSI grid) ───────────────────────────────────────

interface ColorSwatchProps {
  colorKey: string
  value:    string
  onChange: (key: string, val: string) => void
}

function ColorSwatch({ colorKey, value, onChange }: ColorSwatchProps) {
  const nativeRef = useRef<HTMLInputElement>(null)
  return (
    <div className="ce-ansi-swatch-wrap" title={`${colorKey}: ${value}`}>
      <div
        className="ce-ansi-swatch"
        style={{ background: value }}
        onClick={() => nativeRef.current?.click()}
      />
      <input
        ref={nativeRef}
        type="color"
        value={value}
        onChange={e => onChange(colorKey, e.target.value)}
        className="ce-native-picker"
      />
    </div>
  )
}
