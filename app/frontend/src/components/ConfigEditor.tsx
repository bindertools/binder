import React, { useState, useCallback, useEffect, useRef } from 'react'
import {
  THEMES,
  COLOR_SECTIONS,
  ANSI_PAIRS,
  themeToCustomColors,
} from '../themes'
import { AppConfig } from '../types'
import { SHORTCUT_DEFS, eventToKey, setShortcutsPaused } from '../lib/useShortcuts'
import { invoke } from '../lib/ipc'
import './ConfigEditor.scss'

// ── Icons ─────────────────────────────────────────────────────────────────────

const IconCheck = () => (
  <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden>
    <path d="M2.5 7.5L5.5 10.5L11.5 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const IconX = () => (
  <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden>
    <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
  </svg>
)

const IconChevron = ({ expanded }: { expanded: boolean }) => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden
    style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform var(--t-fast)' }}>
    <path d="M3 1.5L7 5L3 8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const IconUndo = () => (
  <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden>
    <path d="M2 2.5V6h3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M2 7a5 5 0 1 0 1.6-3.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
)

interface Props {
  appConfig:           AppConfig
  onSaveSettings:      (cfg: AppConfig) => Promise<void>
  onApply:             (colors: Record<string, string>) => void
  onSaveTheme:         (colors: Record<string, string>) => Promise<void>
  keybindings?:        Record<string, string>
  onSaveKeybindings?:  (bindings: Record<string, string>) => void
}

// ── Section definitions ────────────────────────────────────────────────────────

type SectionId = 'general' | 'appearance' | 'preferences' | 'shortcuts'

const SECTIONS: Array<{ id: SectionId; label: string; description: string; icon: React.ReactNode }> = [
  {
    id: 'general',
    label: 'General',
    description: 'Workspace, shell, and performance',
    icon: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 6.5L8 2l6 4.5V13.5H2V6.5z"/>
        <path d="M6 13.5V9.5h4v4"/>
      </svg>
    ),
  },
  {
    id: 'appearance',
    label: 'Appearance',
    description: 'Themes, colors, and visual display',
    icon: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 13.5c0-3.5 1.5-5.5 4-7l1.5 3C10 8.5 11.5 7 11.5 5a3.5 3.5 0 00-7 0c0 .6.1 1.2.4 1.7"/>
        <circle cx="12" cy="12" r="2.5"/>
      </svg>
    ),
  },
  {
    id: 'preferences',
    label: 'Preferences',
    description: 'Terminal input, zoom, and session behavior',
    icon: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="8" cy="8" r="2"/>
        <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.2 3.2l1.1 1.1M11.7 11.7l1.1 1.1M3.2 12.8l1.1-1.1M11.7 4.3l1.1-1.1"/>
      </svg>
    ),
  },
  {
    id: 'shortcuts',
    label: 'Shortcuts',
    description: 'Keyboard shortcuts and keybindings',
    icon: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1" y="4" width="14" height="9" rx="1.5"/>
        <path d="M4 7.5h.01M7 7.5h.01M10 7.5h.01M4 10h8"/>
      </svg>
    ),
  },
]

// ── Helpers ────────────────────────────────────────────────────────────────────

const PRESET_KEYS = Object.keys(THEMES)

const ZOOM_OPTIONS = [
  { label: '1×',    value: '1'    },
  { label: '1.1×',  value: '1.1'  },
  { label: '1.25×', value: '1.25' },
  { label: '1.5×',  value: '1.5'  },
  { label: '1.75×', value: '1.75' },
  { label: '2×',    value: '2'    },
]

const SHELL_OPTIONS = [
  { label: 'Auto-detect', value: '' },
  { label: 'PowerShell',  value: 'powershell' },
  { label: 'CMD',         value: 'cmd' },
  { label: 'Bash',        value: 'bash' },
  { label: 'Zsh',         value: 'zsh' },
  { label: 'Fish',        value: 'fish' },
]

const ALIGNMENT_OPTIONS = [
  { label: 'Default: type directly in terminal',        value: 'default' },
  { label: 'Top: fixed input bar below tab bar',         value: 'top' },
  { label: 'Bottom: fixed input bar above status bar',   value: 'bottom' },
]

function seedColors(theme: string, saved: Record<string, string>): Record<string, string> {
  if (theme === 'custom' && Object.keys(saved).length > 0) return { ...saved }
  const preset = THEMES[theme] ?? THEMES['dark']
  return themeToCustomColors(preset)
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ConfigEditor({ appConfig, onSaveSettings, onApply, onSaveTheme, keybindings = {}, onSaveKeybindings }: Props) {
  const [activeSection, setActiveSection] = useState<SectionId>('general')
  const [cfg, setCfg]                     = useState<AppConfig>({ ...appConfig })
  const cfgRef                            = useRef(cfg)
  const [saveStatus, setSaveStatus]       = useState<'idle' | 'saved' | 'error'>('idle')
  const saveStatusTimerRef                = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [colors, setColors] = useState<Record<string, string>>(
    () => seedColors(appConfig.theme, appConfig.custom_theme ?? {}),
  )
  const colorsRef  = useRef(colors)
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(['shell', 'terminal', 'editor', 'syntax']),
  )

  // Keep refs in sync with state
  useEffect(() => { cfgRef.current = cfg }, [cfg])
  useEffect(() => { colorsRef.current = colors }, [colors])

  // Sync from external config changes
  useEffect(() => { setCfg({ ...appConfig }) }, [appConfig])
  useEffect(() => {
    if (appConfig.theme === 'custom' && Object.keys(appConfig.custom_theme ?? {}).length > 0) {
      setColors({ ...appConfig.custom_theme! })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appConfig.custom_theme])

  // ── Save helpers ─────────────────────────────────────────────────────────────

  const showSaved = useCallback(() => {
    if (saveStatusTimerRef.current) clearTimeout(saveStatusTimerRef.current)
    setSaveStatus('saved')
    saveStatusTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2000)
  }, [])

  const showError = useCallback(() => {
    if (saveStatusTimerRef.current) clearTimeout(saveStatusTimerRef.current)
    setSaveStatus('error')
    saveStatusTimerRef.current = setTimeout(() => setSaveStatus('idle'), 3000)
  }, [])

  const saveCfg = useCallback((newCfg: AppConfig) => {
    onSaveSettings(newCfg).then(showSaved).catch(showError)
  }, [onSaveSettings, showSaved, showError])

  const saveColors = useCallback((newColors: Record<string, string>) => {
    onSaveTheme(newColors).catch(() => { /* ignore */ })
  }, [onSaveTheme])

  // ── Update handlers ──────────────────────────────────────────────────────────

  const updateCfg = useCallback((patch: Partial<AppConfig>) => {
    const next = { ...cfgRef.current, ...patch }
    cfgRef.current = next
    setCfg(next)
    saveCfg(next)
  }, [saveCfg])

  const handleToggle = useCallback((key: keyof AppConfig) => {
    const next = { ...cfgRef.current, [key]: !cfgRef.current[key] }
    cfgRef.current = next
    setCfg(next)
    saveCfg(next)
  }, [saveCfg])

  const handleGitToggle = useCallback(() => {
    const next = { ...cfgRef.current, git_recognition: { show_git_branch: !cfgRef.current.git_recognition.show_git_branch } }
    cfgRef.current = next
    setCfg(next)
    saveCfg(next)
  }, [saveCfg])

  const handlePresetChange = useCallback((key: string) => {
    const next = { ...cfgRef.current, theme: key }
    cfgRef.current = next
    setCfg(next)
    saveCfg(next)
    if (key === 'custom') {
      const saved = appConfig.custom_theme ?? {}
      if (Object.keys(saved).length > 0) {
        setColors({ ...saved })
        onApply({ ...saved })
      }
    } else if (THEMES[key]) {
      const c = themeToCustomColors(THEMES[key])
      setColors(c)
      onApply(c)
    }
  }, [appConfig.custom_theme, onApply, saveCfg])

  const handleBrowseDir = async () => {
    const dir = await invoke<string>('shell.selectdir').catch(() => '')
    if (dir) updateCfg({ default_directory: dir })
  }

  const handleColorChange = useCallback((key: string, val: string) => {
    const nextColors = { ...colorsRef.current, [key]: val }
    colorsRef.current = nextColors
    setColors(nextColors)
    onApply(nextColors)
    saveColors(nextColors)
    const nextCfg = { ...cfgRef.current, theme: 'custom' }
    cfgRef.current = nextCfg
    setCfg(nextCfg)
    saveCfg(nextCfg)
  }, [onApply, saveColors, saveCfg])

  const handleExport = () => {
    const json = JSON.stringify(colors, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = 'binder-theme.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = () => {
    const input  = document.createElement('input')
    input.type   = 'file'
    input.accept = '.json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const text      = await file.text()
        const parsed    = JSON.parse(text) as Record<string, string>
        colorsRef.current = parsed
        setColors(parsed)
        onApply(parsed)
        saveColors(parsed)
        const nextCfg   = { ...cfgRef.current, theme: 'custom' }
        cfgRef.current  = nextCfg
        setCfg(nextCfg)
        saveCfg(nextCfg)
      } catch { /* ignore bad files */ }
    }
    input.click()
  }

  const toggleExpanded = (id: string) =>
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) } else { next.add(id) }
      return next
    })

  const current = SECTIONS.find(s => s.id === activeSection)!

  return (
    <div className="sp-root">

      {/* ── Left navigation sidebar ───────────────────────────────────────────── */}
      <nav className="sp-nav">
        <div className="sp-nav-header">Settings</div>
        <div className="sp-nav-list">
          {SECTIONS.map(s => (
            <button
              key={s.id}
              className={`sp-nav-item${activeSection === s.id ? ' is-active' : ''}`}
              onClick={() => setActiveSection(s.id)}
            >
              <span className="sp-nav-icon">{s.icon}</span>
              <span className="sp-nav-label">{s.label}</span>
            </button>
          ))}
        </div>
      </nav>

      {/* ── Divider ──────────────────────────────────────────────────────────── */}
      <div className="sp-divider" />

      {/* ── Right content panel ──────────────────────────────────────────────── */}
      <div className="sp-content">

        <div className="sp-content-header">
          <div className="sp-content-title-group">
            <h2 className="sp-content-title">{current.label}</h2>
            <p className="sp-content-subtitle">{current.description}</p>
          </div>
          {saveStatus !== 'idle' && (
            <span className={`sp-save-status${saveStatus === 'saved' ? ' is-saved' : ' is-error'}`}>
              {saveStatus === 'saved' ? <IconCheck /> : <IconX />}
              {saveStatus === 'saved' ? 'Saved' : 'Error'}
            </span>
          )}
        </div>

        <div className="sp-content-body">
          {activeSection === 'general' && (
            <GeneralSection cfg={cfg} updateCfg={updateCfg} onBrowseDir={handleBrowseDir} />
          )}
          {activeSection === 'appearance' && (
            <AppearanceSection
              cfg={cfg}
              colors={colors}
              expanded={expanded}
              onPresetChange={handlePresetChange}
              onColorChange={handleColorChange}
              onToggleExpanded={toggleExpanded}
              onImport={handleImport}
              onExport={handleExport}
              onToggle={handleToggle}
              onGitToggle={handleGitToggle}
              updateCfg={updateCfg}
            />
          )}
          {activeSection === 'preferences' && (
            <PreferencesSection cfg={cfg} updateCfg={updateCfg} onToggle={handleToggle} />
          )}
          {activeSection === 'shortcuts' && onSaveKeybindings && (
            <ShortcutsSection keybindings={keybindings} onSave={onSaveKeybindings} />
          )}
        </div>

      </div>
    </div>
  )
}

// ── Shared primitives ──────────────────────────────────────────────────────────

function SettingRow({
  label,
  description,
  children,
  wide,
}: {
  label: string
  description?: string
  children: React.ReactNode
  wide?: boolean
}) {
  return (
    <div className={`sp-row${wide ? ' sp-row--wide' : ''}`}>
      <div className="sp-row-text">
        <div className="sp-row-label">{label}</div>
        {description && <div className="sp-row-desc">{description}</div>}
      </div>
      <div className="sp-row-ctrl">{children}</div>
    </div>
  )
}

function SettingGroup({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="sp-group">
      {title && <div className="sp-group-title">{title}</div>}
      <div className="sp-group-body">{children}</div>
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      className={`sp-toggle${checked ? ' is-on' : ''}`}
      onClick={onChange}
    >
      <span className="sp-toggle-knob" />
    </button>
  )
}

function SettingSelect({
  value,
  onChange,
  options,
}: {
  value: string | number
  onChange: (v: string) => void
  options: Array<{ label: string; value: string | number }>
}) {
  return (
    <select
      className="sp-select"
      value={String(value)}
      onChange={e => onChange(e.target.value)}
    >
      {options.map(o => (
        <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
      ))}
    </select>
  )
}

// ── Section: General ───────────────────────────────────────────────────────────

function GeneralSection({
  cfg,
  updateCfg,
  onBrowseDir,
}: {
  cfg: AppConfig
  updateCfg: (patch: Partial<AppConfig>) => void
  onBrowseDir: () => void
}) {
  return (
    <>
      <SettingGroup title="Workspace">
        <SettingRow label="Default Directory" description="Directory opened when launching new terminal tabs" wide>
          <div className="sp-dir-row">
            <input
              className="sp-text-input"
              type="text"
              value={cfg.default_directory}
              placeholder="e.g. C:\Projects"
              spellCheck={false}
              onChange={e => updateCfg({ default_directory: e.target.value })}
            />
            <button className="sp-btn sp-btn--ghost sp-btn--sm" onClick={onBrowseDir} title="Browse">
              …
            </button>
          </div>
        </SettingRow>
        <SettingRow label="Preferred Shell" description="Shell executable used when opening new terminal tabs">
          <SettingSelect
            value={cfg.preferred_shell ?? ''}
            onChange={v => updateCfg({ preferred_shell: v })}
            options={SHELL_OPTIONS}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Performance">
        <SettingRow label="Scroll Speed" description="Mouse wheel scroll multiplier applied in terminal panels">
          <div className="sp-range-row">
            <input
              type="range"
              className="sp-range"
              min={1}
              max={10}
              step={1}
              value={cfg.scroll_speed ?? 3}
              onChange={e => updateCfg({ scroll_speed: parseInt(e.target.value) })}
            />
            <span className="sp-range-val">{cfg.scroll_speed ?? 3}×</span>
          </div>
        </SettingRow>
      </SettingGroup>
    </>
  )
}

// ── Section: Appearance ────────────────────────────────────────────────────────

function AppearanceSection({
  cfg,
  colors,
  expanded,
  onPresetChange,
  onColorChange,
  onToggleExpanded,
  onImport,
  onExport,
  onToggle,
  onGitToggle,
  updateCfg,
}: {
  cfg: AppConfig
  colors: Record<string, string>
  expanded: Set<string>
  onPresetChange: (key: string) => void
  onColorChange: (key: string, val: string) => void
  onToggleExpanded: (id: string) => void
  onImport: () => void
  onExport: () => void
  onToggle: (k: keyof AppConfig) => void
  onGitToggle: () => void
  updateCfg: (patch: Partial<AppConfig>) => void
}) {
  const themeOptions = [
    ...PRESET_KEYS.map(k => ({ label: k, value: k })),
    { label: 'custom', value: 'custom' },
  ]

  return (
    <>
      <SettingGroup title="Theme">
        <SettingRow label="Color Theme" description="Select a built-in preset or customize individual UI colors below">
          <SettingSelect
            value={cfg.theme}
            onChange={onPresetChange}
            options={themeOptions}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Terminal">
        <SettingRow label="Show Timestamps" description="Display the time each command was executed">
          <Toggle checked={!!cfg.show_timestamps} onChange={() => onToggle('show_timestamps')} />
        </SettingRow>
        <SettingRow label="Minimal PWD" description="Show a shortened working directory path in the prompt">
          <Toggle checked={!!cfg.minimal_pwd} onChange={() => onToggle('minimal_pwd')} />
        </SettingRow>
        <SettingRow label="Git Branch in Prompt" description="Display the active git branch next to the prompt">
          <Toggle checked={cfg.git_recognition.show_git_branch} onChange={onGitToggle} />
        </SettingRow>
        <SettingRow label="Word Wrap" description="Soft-wrap long output lines in the terminal">
          <Toggle checked={!!cfg.terminal_word_wrap} onChange={() => onToggle('terminal_word_wrap')} />
        </SettingRow>
        <SettingRow label="History Limit" description="Maximum number of commands saved to persistent history">
          <div className="sp-range-row">
            <input
              type="range"
              className="sp-range"
              min={100}
              max={10000}
              step={100}
              value={cfg.max_history ?? 1000}
              onChange={e => updateCfg({ max_history: parseInt(e.target.value) })}
            />
            <span className="sp-range-val">{(cfg.max_history ?? 1000).toLocaleString()}</span>
          </div>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Code Editor">
        <SettingRow label="Minimap" description="Show a miniaturized overview of the file on the right edge">
          <Toggle checked={!!cfg.minimap} onChange={() => onToggle('minimap')} />
        </SettingRow>
        <SettingRow label="Indent Guides" description="Show vertical lines marking each indentation level">
          <Toggle checked={!!cfg.indent_guides} onChange={() => onToggle('indent_guides')} />
        </SettingRow>
        <SettingRow label="Word Wrap" description="Soft-wrap long lines to fit the editor viewport">
          <Toggle checked={!!cfg.file_word_wrap} onChange={() => onToggle('file_word_wrap')} />
        </SettingRow>
        <SettingRow label="Directories First" description="Sort folders above files in the file tree">
          <Toggle checked={!!cfg.order_directory} onChange={() => onToggle('order_directory')} />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Custom Colors">
        <div className="sp-color-toolbar">
          <span className="sp-color-toolbar-hint">Customize individual UI and syntax colors</span>
          <button className="sp-btn sp-btn--ghost sp-btn--sm" onClick={onImport}>Import</button>
          <button className="sp-btn sp-btn--ghost sp-btn--sm" onClick={onExport}>Export</button>
        </div>
        <div className="sp-color-sections">
          {COLOR_SECTIONS.map(section => (
            <div key={section.id} className="sp-color-section">
              <button
                className="sp-color-section-head"
                onClick={() => onToggleExpanded(section.id)}
              >
                <span className="sp-chevron"><IconChevron expanded={expanded.has(section.id)} /></span>
                <span className="sp-color-section-label">{section.label}</span>
                <span className="sp-color-section-count">{section.items.length} colors</span>
              </button>

              {expanded.has(section.id) && (
                <div className="sp-color-section-body">
                  {section.items.map(spec => (
                    <ColorRow
                      key={spec.key}
                      label={spec.label}
                      colorKey={spec.key}
                      value={colors[spec.key] ?? '#000000'}
                      onChange={onColorChange}
                    />
                  ))}
                  {section.id === 'terminal' && (
                    <AnsiGrid colors={colors} onChange={onColorChange} />
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </SettingGroup>
    </>
  )
}

// ── Section: Preferences ───────────────────────────────────────────────────────

function PreferencesSection({
  cfg,
  updateCfg,
  onToggle,
}: {
  cfg: AppConfig
  updateCfg: (patch: Partial<AppConfig>) => void
  onToggle: (k: keyof AppConfig) => void
}) {
  return (
    <>
      <SettingGroup title="Terminal Input">
        <SettingRow label="Command Line Alignment" description="Where the command input field appears in terminal panels">
          <SettingSelect
            value={cfg.command_alignment || 'default'}
            onChange={v => updateCfg({ command_alignment: v as 'default' | 'top' | 'bottom' })}
            options={ALIGNMENT_OPTIONS}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Display Scale">
        <SettingRow label="Default Zoom" description="Base font scale factor applied when the application starts">
          <SettingSelect
            value={cfg.default_zoom}
            onChange={v => updateCfg({ default_zoom: parseFloat(v) })}
            options={ZOOM_OPTIONS}
          />
        </SettingRow>
        <SettingRow label="Zoom Insights" description="Show keyboard shortcuts for adjusting zoom in the status bar">
          <Toggle checked={!!cfg.zoom_insights} onChange={() => onToggle('zoom_insights')} />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Session">
        <SettingRow label="Soft Close" description="Ask for confirmation before closing a tab with an active process">
          <Toggle checked={!!cfg.soft_close} onChange={() => onToggle('soft_close')} />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Privacy">
        <SettingRow label="Database Privacy Mode" description="Blur all cell data in database views. Click any cell to reveal it. Designed for screensharing and livestreams.">
          <Toggle checked={!!cfg.database_privacy} onChange={() => onToggle('database_privacy')} />
        </SettingRow>
      </SettingGroup>
    </>
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
    <div className="sp-color-row">
      <span className="sp-color-label">{label}</span>
      <div className="sp-color-ctrl">
        <div
          className="sp-swatch"
          style={{ background: value }}
          onClick={() => nativeRef.current?.click()}
          title="Click to open colour picker"
        />
        <input
          ref={nativeRef}
          type="color"
          value={value}
          onChange={e => onChange(colorKey, e.target.value)}
          className="sp-native-picker"
        />
        <input
          type="text"
          className="sp-hex-input"
          value={text}
          spellCheck={false}
          maxLength={7}
          onChange={e => setText(e.target.value)}
          onBlur={() => {
            const v = text.trim()
            if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(colorKey, v)
            else setText(value)
          }}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
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
    <div className="sp-ansi-swatch-wrap" title={`${colorKey}: ${value}`}>
      <div
        className="sp-ansi-swatch"
        style={{ background: value }}
        onClick={() => nativeRef.current?.click()}
      />
      <input
        ref={nativeRef}
        type="color"
        value={value}
        onChange={e => onChange(colorKey, e.target.value)}
        className="sp-native-picker"
      />
    </div>
  )
}

// ── ANSI grid ──────────────────────────────────────────────────────────────────

function AnsiGrid({ colors, onChange }: { colors: Record<string, string>; onChange: (k: string, v: string) => void }) {
  return (
    <div className="sp-ansi">
      <div className="sp-ansi-title">ANSI Colors</div>
      <div className="sp-ansi-col-head">
        <span />
        <span>Normal</span>
        <span>Bright</span>
      </div>
      {ANSI_PAIRS.map(pair => (
        <div key={pair.label} className="sp-ansi-row">
          <span className="sp-ansi-label">{pair.label}</span>
          <ColorSwatch colorKey={pair.normal} value={colors[pair.normal] ?? '#000000'} onChange={onChange} />
          <ColorSwatch colorKey={pair.bright}  value={colors[pair.bright]  ?? '#666666'} onChange={onChange} />
        </div>
      ))}
    </div>
  )
}

// ── Section: Keyboard Shortcuts ────────────────────────────────────────────────

const SHORTCUT_GROUPS = [...new Set(SHORTCUT_DEFS.map(d => d.group))]

function ShortcutsSection({
  keybindings,
  onSave,
}: {
  keybindings: Record<string, string>
  onSave: (bindings: Record<string, string>) => void
}) {
  const [bindings,   setBindings]   = useState<Record<string, string>>(keybindings)
  const [capturing,  setCapturing]  = useState<string | null>(null)
  const [query,      setQuery]      = useState('')
  const bindingsRef = useRef(bindings)

  useEffect(() => { setBindings(keybindings) }, [keybindings])
  useEffect(() => { bindingsRef.current = bindings }, [bindings])

  // Key capture for rebinding
  useEffect(() => {
    if (!capturing) return
    setShortcutsPaused(true)
    const handler = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopImmediatePropagation()
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return
      if (e.key === 'Escape') { setCapturing(null); setShortcutsPaused(false); return }
      const key = eventToKey(e)
      const next = { ...bindingsRef.current, [capturing]: key }
      setBindings(next)
      onSave(next)
      setCapturing(null)
      setShortcutsPaused(false)
    }
    window.addEventListener('keydown', handler, true)
    return () => { window.removeEventListener('keydown', handler, true); setShortcutsPaused(false) }
  }, [capturing, onSave])

  const filtered = query
    ? SHORTCUT_DEFS.filter(d =>
        d.label.toLowerCase().includes(query.toLowerCase()) ||
        d.description.toLowerCase().includes(query.toLowerCase()),
      )
    : SHORTCUT_DEFS

  const resetAll = () => {
    setBindings({})
    onSave({})
  }

  return (
    <div className="sp-sc">
      <div className="sp-sc-toolbar">
        <input
          className="sp-text-input"
          placeholder="Search shortcuts…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <button className="sp-btn sp-btn--ghost sp-btn--sm" onClick={resetAll}>Reset all</button>
      </div>

      {SHORTCUT_GROUPS.map(group => {
        const defs = filtered.filter(d => d.group === group)
        if (defs.length === 0) return null
        return (
          <SettingGroup key={group} title={group}>
            {defs.map(def => {
              const bound     = bindings[def.id] ?? def.defaultKey
              const isDefault = !(def.id in bindings) || bindings[def.id] === def.defaultKey
              return (
                <div key={def.id} className="sp-row">
                  <div className="sp-row-text">
                    <div className="sp-row-label">{def.label}</div>
                    <div className="sp-row-desc">{def.description}</div>
                  </div>
                  <div className="sp-row-ctrl sp-sc-ctrl">
                    {capturing === def.id ? (
                      <button
                        className="sp-kbd sp-kbd--capturing"
                        onClick={() => setCapturing(null)}
                      >
                        Press any key…
                      </button>
                    ) : (
                      <>
                        <button
                          className="sp-kbd"
                          onClick={() => setCapturing(def.id)}
                          title="Click to rebind"
                        >
                          {bound.split('+').map((k, i) => (
                            <React.Fragment key={i}>
                              {i > 0 && <span className="sp-kbd-plus">+</span>}
                              <kbd>{k}</kbd>
                            </React.Fragment>
                          ))}
                        </button>
                        {!isDefault && (
                          <button
                            className="sp-kbd-reset"
                            title="Reset to default"
                            onClick={() => {
                              const next = { ...bindingsRef.current }
                              delete next[def.id]
                              setBindings(next)
                              onSave(next)
                            }}
                          >
                            <IconUndo />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </SettingGroup>
        )
      })}
    </div>
  )
}
