import React, { useState, useCallback, useEffect, useRef } from 'react'
import {
  THEMES,
  COLOR_SECTIONS,
  ANSI_PAIRS,
  themeToCustomColors,
} from '../themes'
import './ThemeEditor.scss'

interface Props {
  /** The active theme key stored in config ('dark', 'custom', etc.) */
  currentTheme: string
  /** Last-saved custom color map from config (empty when no custom theme saved yet) */
  savedColors:  Record<string, string>
  /** Called on every color change — triggers live preview in App */
  onApply:      (colors: Record<string, string>) => void
  /** Called when the user clicks "Save" — persists to config */
  onSave:       (colors: Record<string, string>) => Promise<void>
}

// ── helpers ────────────────────────────────────────────────────────────────────

function seedColors(theme: string, saved: Record<string, string>): Record<string, string> {
  if (theme === 'custom' && Object.keys(saved).length > 0) return { ...saved }
  const preset = THEMES[theme] ?? THEMES['dark']
  return themeToCustomColors(preset)
}

// Preset names in display order
const PRESET_KEYS = Object.keys(THEMES)

// ── component ──────────────────────────────────────────────────────────────────

export default function ThemeEditor({ currentTheme, savedColors, onApply, onSave }: Props) {
  const [colors,      setColors]      = useState<Record<string, string>>(
    () => seedColors(currentTheme, savedColors),
  )
  const [activePreset, setActivePreset] = useState<string>(
    currentTheme === 'custom' ? 'custom' : currentTheme,
  )
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(['presets', 'shell', 'terminal', 'editor', 'syntax']),
  )
  const [saving,  setSaving]  = useState(false)
  const [saveMsg, setSaveMsg] = useState<'idle' | 'saved' | 'error'>('idle')

  // Re-seed if savedColors prop changes (e.g., after a successful save)
  useEffect(() => {
    if (currentTheme === 'custom' && Object.keys(savedColors).length > 0) {
      setColors({ ...savedColors })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedColors])

  // ── event handlers ───────────────────────────────────────────────────────────

  const handleColorChange = useCallback((key: string, val: string) => {
    setColors(prev => {
      const next = { ...prev, [key]: val }
      onApply(next)
      return next
    })
    setActivePreset('custom')
    setSaveMsg('idle')
  }, [onApply])

  const handleLoadPreset = useCallback((key: string) => {
    const preset = THEMES[key]
    if (!preset) return
    const c = themeToCustomColors(preset)
    setColors(c)
    onApply(c)
    setActivePreset(key)
    setSaveMsg('idle')
  }, [onApply])

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(colors)
      setSaveMsg('saved')
      setTimeout(() => setSaveMsg('idle'), 2500)
    } catch {
      setSaveMsg('error')
      setTimeout(() => setSaveMsg('idle'), 3000)
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    const c = seedColors(currentTheme, savedColors)
    setColors(c)
    onApply(c)
    setActivePreset(currentTheme === 'custom' ? 'custom' : currentTheme)
    setSaveMsg('idle')
  }

  const handleExport = () => {
    const json = JSON.stringify(colors, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = 'terminal-ide-theme.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = () => {
    const input = document.createElement('input')
    input.type  = 'file'
    input.accept = '.json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const text = await file.text()
        const parsed = JSON.parse(text) as Record<string, string>
        setColors(parsed)
        onApply(parsed)
        setActivePreset('custom')
        setSaveMsg('idle')
      } catch { /* ignore bad files */ }
    }
    input.click()
  }

  const toggleSection = (id: string) =>
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) } else { next.add(id) }
      return next
    })

  // ── save button label ────────────────────────────────────────────────────────
  const saveLabel =
    saving            ? 'Saving…'        :
    saveMsg === 'saved' ? '✓ Saved'       :
    saveMsg === 'error' ? '✕ Error'       :
    'Save Custom Theme'

  // ── render ───────────────────────────────────────────────────────────────────
  return (
    <div className="te-pane">

      {/* ── header ────────────────────────────────────────────────────────── */}
      <div className="te-header">
        <span className="te-title">Theme Editor</span>
        <div className="te-header-spacer" />
        <button className="te-btn te-btn--ghost" onClick={handleImport} title="Import theme JSON">
          Import
        </button>
        <button className="te-btn te-btn--ghost" onClick={handleExport} title="Export theme JSON">
          Export
        </button>
        <button className="te-btn te-btn--ghost" onClick={handleReset}>
          Reset
        </button>
        <button
          className={`te-btn te-btn--primary${saveMsg === 'saved' ? ' is-saved' : ''}${saveMsg === 'error' ? ' is-error' : ''}`}
          onClick={handleSave}
          disabled={saving}
        >
          {saveLabel}
        </button>
      </div>

      {/* ── scrollable body ───────────────────────────────────────────────── */}
      <div className="te-body">

        {/* Preset cards */}
        <div className="te-section">
          <button className="te-section-head" onClick={() => toggleSection('presets')}>
            <span className="te-chevron">{expanded.has('presets') ? '▾' : '▸'}</span>
            <span className="te-section-label">Preset Themes</span>
          </button>

          {expanded.has('presets') && (
            <div className="te-section-body te-presets-grid">
              {PRESET_KEYS.map(key => {
                const t = THEMES[key]
                return (
                  <button
                    key={key}
                    className={`te-preset-card${activePreset === key ? ' is-active' : ''}`}
                    onClick={() => handleLoadPreset(key)}
                  >
                    {/* Mini visual preview */}
                    <div className="te-preset-thumb" style={{ background: t.appBg }}>
                      <div className="te-preset-thumb-bar"
                        style={{ background: t.borderColor }} />
                      <div className="te-preset-thumb-row">
                        <span className="te-preset-thumb-prompt"
                          style={{ color: t.xtermTheme.cyan ?? '#11a8cd' }}>
                          &gt;_
                        </span>
                        <span className="te-preset-thumb-text"
                          style={{ color: t.xtermTheme.foreground }}>
                          hello
                        </span>
                      </div>
                      <div className="te-preset-thumb-dots">
                        {[t.xtermTheme.red, t.xtermTheme.green, t.xtermTheme.blue].map((col, i) => (
                          <span key={i} className="te-preset-dot"
                            style={{ background: col ?? '#888' }} />
                        ))}
                      </div>
                    </div>
                    <span className="te-preset-name">{key}</span>
                  </button>
                )
              })}

              {/* Custom indicator — not clickable, just shows state */}
              <div className={`te-preset-card te-preset-card--custom${activePreset === 'custom' ? ' is-active' : ''}`}>
                <div className="te-preset-thumb te-preset-thumb--custom">
                  <span>✎</span>
                </div>
                <span className="te-preset-name">custom</span>
              </div>
            </div>
          )}
        </div>

        {/* Color sections */}
        {COLOR_SECTIONS.map(section => (
          <div key={section.id} className="te-section">
            <button
              className="te-section-head"
              onClick={() => toggleSection(section.id)}
            >
              <span className="te-chevron">{expanded.has(section.id) ? '▾' : '▸'}</span>
              <span className="te-section-label">{section.label}</span>
              <span className="te-section-count">{section.items.length} colors</span>
            </button>

            {expanded.has(section.id) && (
              <div className="te-section-body">
                {section.items.map(spec => (
                  <ColorRow
                    key={spec.key}
                    label={spec.label}
                    colorKey={spec.key}
                    value={colors[spec.key] ?? '#000000'}
                    onChange={handleColorChange}
                  />
                ))}

                {/* ANSI color grid injected into the terminal section */}
                {section.id === 'terminal' && (
                  <div className="te-ansi">
                    <div className="te-ansi-title">ANSI Colors</div>
                    <div className="te-ansi-grid">
                      <div className="te-ansi-col-head">
                        <span />
                        <span>Normal</span>
                        <span>Bright</span>
                      </div>
                      {ANSI_PAIRS.map(pair => (
                        <div key={pair.label} className="te-ansi-row">
                          <span className="te-ansi-label">{pair.label}</span>
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
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        <div className="te-footer-pad" />
      </div>
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

  // Keep text input in sync when the value prop changes externally
  useEffect(() => { setText(value) }, [value])

  return (
    <div className="te-color-row">
      <span className="te-color-label">{label}</span>
      <div className="te-color-ctrl">
        {/* Colour swatch — clicking opens the native colour picker */}
        <div
          className="te-swatch"
          style={{ background: value }}
          onClick={() => nativeRef.current?.click()}
          title="Click to open colour picker"
        />
        {/* Hidden native colour picker */}
        <input
          ref={nativeRef}
          type="color"
          value={value}
          onChange={e => onChange(colorKey, e.target.value)}
          className="te-native-picker"
        />
        {/* Editable hex text */}
        <input
          type="text"
          className="te-hex-input"
          value={text}
          spellCheck={false}
          maxLength={7}
          onChange={e => setText(e.target.value)}
          onBlur={() => {
            const v = text.trim()
            if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(colorKey, v)
            else setText(value) // revert invalid input
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
    <div className="te-ansi-swatch-wrap" title={`${colorKey}: ${value}`}>
      <div
        className="te-ansi-swatch"
        style={{ background: value }}
        onClick={() => nativeRef.current?.click()}
      />
      <input
        ref={nativeRef}
        type="color"
        value={value}
        onChange={e => onChange(colorKey, e.target.value)}
        className="te-native-picker"
      />
    </div>
  )
}
