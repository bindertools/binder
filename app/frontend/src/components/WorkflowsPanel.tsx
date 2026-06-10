import React, { useState, useEffect, useCallback, useRef } from 'react'
import MonacoEditor from '@monaco-editor/react'
import type * as Monaco from 'monaco-editor'
import { workflows, type WorkflowFile, type ActStatus } from '../lib/workflows'
import { invoke, on, off } from '../lib/ipc'

interface Props {
  cwd:             string
  active:          boolean
  monacoTheme?:    string
  monacoThemeDef?: Monaco.editor.IStandaloneThemeData
}

// ── Icons ─────────────────────────────────────────────────────────────────────

const RefreshIcon = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 2a5 5 0 11-1.5 7.5"/>
    <path d="M10 2v3h-3"/>
  </svg>
)

const BackIcon = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7.5 2.5L3 6l4.5 3.5"/>
  </svg>
)

const ChevronRightIcon = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-50">
    <path d="M3.5 2l3 3-3 3"/>
  </svg>
)

const PlayIcon = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor" stroke="none">
    <path d="M3 2l7 4-7 4V2z"/>
  </svg>
)

const StopIcon = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor" stroke="none">
    <rect x="2.5" y="2.5" width="7" height="7" rx="1"/>
  </svg>
)

// Strip ANSI escape sequences (act emits coloured output) for plain-text display.
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '')
}

// ── Small UI bits ─────────────────────────────────────────────────────────────

function IconBtn({
  title, onClick, disabled, children,
}: { title: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={e => { e.stopPropagation(); onClick() }}
      className="flex items-center justify-center w-5 h-5 rounded text-[var(--tab-color)] hover:text-[var(--tab-color-hover)] hover:bg-surface-raised border-0 bg-transparent cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed transition-[background,color] duration-[100ms]"
    >
      {children}
    </button>
  )
}

function TriggerBadge({ label }: { label: string }) {
  return (
    <span className="px-1.5 py-[1px] rounded text-[9.5px] font-mono uppercase tracking-wide bg-surface-raised text-[var(--tab-color)] border border-sep">
      {label}
    </span>
  )
}

// ── Workflow list row ─────────────────────────────────────────────────────────

function WorkflowRow({ wf, onSelect }: { wf: WorkflowFile; onSelect: () => void }) {
  return (
    <div
      className="group flex flex-col gap-1 px-3 py-2 cursor-pointer select-none hover:bg-surface-raised border-b border-[var(--border-color)]"
      onClick={onSelect}
    >
      <div className="flex items-center gap-1.5">
        <span className="flex-1 min-w-0 truncate text-[12px] font-medium text-[var(--tab-color-hover)]">
          {wf.name}
        </span>
        <ChevronRightIcon />
      </div>
      <div className="flex items-center gap-1 flex-wrap">
        {wf.triggers.length === 0 && (
          <span className="text-[10px] text-[var(--tab-color)] opacity-40">no triggers detected</span>
        )}
        {wf.triggers.map(t => <TriggerBadge key={t} label={t} />)}
      </div>
      <div className="text-[10px] text-[var(--tab-color)] opacity-60 truncate">
        {wf.path}
      </div>
      {wf.lastCommit && (
        <div className="text-[10px] text-[var(--tab-color)] opacity-50 truncate">
          <span className="font-mono">{wf.lastCommit.hash}</span>
          {' · '}{wf.lastCommit.message}
          {' · '}{wf.lastCommit.date}
        </div>
      )}
    </div>
  )
}

function TextBtn({
  label, onClick, disabled, variant = 'ghost',
}: { label: string; onClick: () => void; disabled?: boolean; variant?: 'ghost' | 'primary' }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={[
        'px-2 py-0.5 rounded text-[11px] border-0 cursor-pointer transition-[background,color] duration-[100ms] disabled:opacity-30 disabled:cursor-not-allowed',
        variant === 'primary'
          ? 'bg-accent text-white hover:opacity-90'
          : 'bg-transparent text-[var(--tab-color)] hover:text-[var(--tab-color-hover)] hover:bg-surface-raised',
      ].join(' ')}
    >
      {label}
    </button>
  )
}

// ── Run panel ─────────────────────────────────────────────────────────────────

interface RunPanelProps {
  cwd:       string
  workflow:  WorkflowFile
  actStatus: ActStatus | null
}

const ACT_INSTALL_URL = 'https://github.com/nektos/act#installation'

function RunPanel({ cwd, workflow, actStatus }: RunPanelProps) {
  const [running,  setRunning]  = useState(false)
  const [output,   setOutput]   = useState('')
  const [exitCode, setExitCode] = useState<number | null>(null)
  const runIdRef  = useRef<string | null>(null)
  const outRef    = useRef<HTMLPreElement>(null)

  // Tear down any active subscriptions / running process on unmount or workflow change.
  useEffect(() => {
    return () => {
      const id = runIdRef.current
      if (id) {
        off(`workflows:output:${id}`, () => {})
        off(`workflows:done:${id}`, () => {})
        workflows.stop(id).catch(() => {})
      }
    }
  }, [workflow.file])

  useEffect(() => {
    if (outRef.current) outRef.current.scrollTop = outRef.current.scrollHeight
  }, [output])

  const handleRun = useCallback(async () => {
    const runId = crypto.randomUUID()
    runIdRef.current = runId
    setOutput('')
    setExitCode(null)
    setRunning(true)

    const onOutput = (data: unknown) => {
      setOutput(prev => prev + stripAnsi(String(data)))
    }
    const onDone = (data: unknown) => {
      const code = (data as { code?: number })?.code ?? null
      setExitCode(code)
      setRunning(false)
      off(`workflows:output:${runId}`, onOutput)
      off(`workflows:done:${runId}`, onDone)
      runIdRef.current = null
    }

    on(`workflows:output:${runId}`, onOutput)
    on(`workflows:done:${runId}`, onDone)

    try {
      await workflows.run(cwd, workflow.file, runId)
    } catch (e: any) {
      setOutput(prev => prev + `\nerror: ${e?.message ?? 'failed to start act'}\n`)
      setRunning(false)
      off(`workflows:output:${runId}`, onOutput)
      off(`workflows:done:${runId}`, onDone)
      runIdRef.current = null
    }
  }, [cwd, workflow.file])

  const handleStop = useCallback(() => {
    const id = runIdRef.current
    if (id) workflows.stop(id).catch(() => {})
  }, [])

  if (!actStatus) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--tab-color)] text-[11px] opacity-50">
        checking for act…
      </div>
    )
  }

  if (!actStatus.installed) {
    return (
      <div className="flex flex-col gap-2 p-3">
        <div className="text-[11px] text-[var(--tab-color-hover)]">
          <span className="font-mono bg-surface-raised border border-sep rounded px-1">act</span> is not installed.
          Install it to run workflows locally in a sandbox.
        </div>
        <div className="font-mono text-[10px] bg-surface-raised border border-sep rounded p-2 text-[var(--tab-color)]">
          winget install nektos.act
        </div>
        <div className="font-mono text-[10px] bg-surface-raised border border-sep rounded p-2 text-[var(--tab-color)]">
          choco install act-cli
        </div>
        <TextBtn
          label="View install instructions"
          onClick={() => { invoke('shell.openUrl', { url: ACT_INSTALL_URL }).catch(() => {}) }}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-[var(--border-color)] shrink-0">
        {!running ? (
          <button
            onClick={handleRun}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] border-0 cursor-pointer bg-accent text-white hover:opacity-90 transition-opacity duration-[100ms]"
          >
            <PlayIcon /> Run Locally
          </button>
        ) : (
          <button
            onClick={handleStop}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] border-0 cursor-pointer bg-transparent text-[var(--tab-color)] hover:text-[var(--tab-color-hover)] hover:bg-surface-raised transition-[background,color] duration-[100ms]"
          >
            <StopIcon /> Stop
          </button>
        )}
        {running && <span className="text-[10px] text-[var(--tab-color)] opacity-60">running…</span>}
        {!running && exitCode !== null && (
          <span className={`text-[10px] font-mono ${exitCode === 0 ? 'text-green-400' : 'text-red-400'}`}>
            exit {exitCode}
          </span>
        )}
        <span className="ml-auto text-[10px] text-[var(--tab-color)] opacity-40 font-mono">act {actStatus.version}</span>
      </div>
      <pre
        ref={outRef}
        className="flex-1 overflow-auto m-0 p-2 text-[10.5px] font-mono leading-[1.5] text-[var(--tab-color-hover)] whitespace-pre-wrap break-all"
      >
        {output || (running ? '' : 'Click "Run Locally" to execute this workflow with act.')}
      </pre>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function WorkflowsPanel({ cwd, active, monacoTheme, monacoThemeDef }: Props) {
  const [list,     setList]     = useState<WorkflowFile[]>([])
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [selected, setSelected] = useState<WorkflowFile | null>(null)
  const [content,  setContent]  = useState('')
  const [contentLoading, setContentLoading] = useState(false)
  const [detailTab, setDetailTab] = useState<'code' | 'run'>('code')
  const [actStatus, setActStatus] = useState<ActStatus | null>(null)

  useEffect(() => {
    workflows.checkAct().then(setActStatus).catch(() => setActStatus({ installed: false, version: '' }))
  }, [])

  const refresh = useCallback(async () => {
    if (!cwd) return
    setLoading(true)
    try {
      const r = await workflows.list(cwd)
      setList(r.workflows)
      setError(null)
    } catch (e: any) {
      setError(e?.message ?? 'failed to list workflows')
    } finally {
      setLoading(false)
    }
  }, [cwd])

  useEffect(() => {
    if (!active) return
    refresh()
  }, [active, refresh])

  // Re-apply a custom theme definition if it changes while this panel is mounted.
  useEffect(() => {
    if (!monacoThemeDef || !monacoTheme) return
    const api = (window as any).monaco as typeof Monaco | undefined
    if (!api) return
    api.editor.defineTheme(monacoTheme, monacoThemeDef)
  }, [monacoTheme, monacoThemeDef])

  const openWorkflow = useCallback(async (wf: WorkflowFile) => {
    setSelected(wf)
    setDetailTab('code')
    setContent('')
    setContentLoading(true)
    try {
      const r = await workflows.read(cwd, wf.file)
      setContent(r.content)
    } catch (e: any) {
      setContent(`# failed to read workflow\n# ${e?.message ?? 'error'}`)
    } finally {
      setContentLoading(false)
    }
  }, [cwd])

  if (!cwd) return (
    <div className="flex items-center justify-center h-full text-[var(--tab-color)] text-[11px] opacity-50 p-4 text-center">
      Open a terminal to use Workflows
    </div>
  )

  // ── Detail view ──────────────────────────────────────────────────────────────
  if (selected) {
    return (
      <div className="flex flex-col h-full overflow-hidden bg-[var(--app-bg)] text-[var(--tab-color-hover)]">
        <div className="flex items-center gap-1.5 px-2 py-2 border-b border-[var(--border-color)] shrink-0">
          <IconBtn title="Back to list" onClick={() => setSelected(null)}>
            <BackIcon />
          </IconBtn>
          <span className="flex-1 min-w-0 truncate text-[12px] font-medium">{selected.name}</span>
        </div>

        <div className="px-3 py-2 border-b border-[var(--border-color)] shrink-0 flex flex-col gap-1.5">
          <div className="text-[10px] text-[var(--tab-color)] opacity-60 truncate font-mono">{selected.path}</div>
          <div className="flex items-center gap-1 flex-wrap">
            {selected.triggers.map(t => <TriggerBadge key={t} label={t} />)}
          </div>
          {selected.lastCommit && (
            <div className="text-[10px] text-[var(--tab-color)] opacity-50 truncate">
              <span className="font-mono">{selected.lastCommit.hash}</span>
              {' · '}{selected.lastCommit.message}
              {' · '}{selected.lastCommit.date}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 px-2 pt-1.5 border-b border-[var(--border-color)] shrink-0">
          {(['code', 'run'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setDetailTab(tab)}
              className={[
                'px-2.5 py-1 text-[11px] rounded-t border-0 border-b-2 cursor-pointer transition-colors duration-[100ms] -mb-px',
                detailTab === tab
                  ? 'text-[var(--tab-color-hover)] border-accent bg-surface-raised'
                  : 'text-[var(--tab-color)] border-transparent hover:text-[var(--tab-color-hover)] bg-transparent',
              ].join(' ')}
            >
              {tab === 'code' ? 'Code' : 'Run'}
            </button>
          ))}
        </div>

        <div className="flex-1 min-h-0">
          {detailTab === 'code' ? (
            contentLoading ? (
              <div className="flex items-center justify-center h-full text-[var(--tab-color)] text-[11px] opacity-50">
                loading…
              </div>
            ) : (
              <MonacoEditor
                height="100%"
                language="yaml"
                value={content}
                theme={monacoTheme}
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  fontSize: 12,
                  scrollBeyondLastLine: false,
                  wordWrap: 'on',
                }}
              />
            )
          ) : (
            <RunPanel cwd={cwd} workflow={selected} actStatus={actStatus} />
          )}
        </div>
      </div>
    )
  }

  // ── List view ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden bg-[var(--app-bg)] text-[var(--tab-color-hover)]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)] shrink-0">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--tab-color)] opacity-60">
          Workflows {list.length > 0 && <span className="opacity-80">({list.length})</span>}
        </span>
        <IconBtn title="Refresh" onClick={refresh} disabled={loading}>
          <RefreshIcon />
        </IconBtn>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {loading && list.length === 0 && (
          <div className="flex items-center justify-center py-8 text-[var(--tab-color)] text-[11px] opacity-50">
            loading…
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center gap-2 py-8 px-4 text-center">
            <div className="text-[var(--tab-color)] text-[11px] opacity-70">{error}</div>
          </div>
        )}

        {!loading && !error && list.length === 0 && (
          <div className="flex items-center justify-center py-8 text-[var(--tab-color)] text-[11px] opacity-50 text-center px-4">
            No workflows found in .github/workflows
          </div>
        )}

        {list.map(wf => (
          <WorkflowRow key={wf.file} wf={wf} onSelect={() => openWorkflow(wf)} />
        ))}
      </div>
    </div>
  )
}
