import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import MonacoEditor from '@monaco-editor/react'
import type * as Monaco from 'monaco-editor'
import { workflows, type WorkflowFile, type RunnerStatus, type WorkflowStepEvent } from '../lib/workflows'
import { on, off } from '../lib/ipc'
import { Skeleton } from './Skeleton'

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

const CheckIcon = () => (
  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.5 6.5l2.5 2.5 4.5-5.5"/>
  </svg>
)

const CrossIcon = () => (
  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3l6 6M9 3l-6 6"/>
  </svg>
)

const SkipIcon = () => (
  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.5 6h7"/>
  </svg>
)

// Strip ANSI escape sequences for plain-text display.
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

function Spinner({ size = 16 }: { size?: number }) {
  return (
    <div
      className="rounded-full animate-spin shrink-0"
      style={{
        width: size, height: size,
        border: '2px solid var(--sep-strong)',
        borderTopColor: 'var(--accent)',
      }}
    />
  )
}

// ── Workflow list row ─────────────────────────────────────────────────────────

function WorkflowRow({ wf, selected, onSelect }: { wf: WorkflowFile; selected: boolean; onSelect: () => void }) {
  return (
    <div
      className={[
        'group flex flex-col gap-1 px-3 py-2 cursor-pointer select-none border-b border-[var(--border-color)]',
        selected ? 'bg-surface-raised' : 'hover:bg-surface-raised',
      ].join(' ')}
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

function WorkflowRowSkeleton() {
  return (
    <div className="flex flex-col gap-1.5 px-3 py-2 border-b border-[var(--border-color)]">
      <Skeleton width="60%" height={12} />
      <div className="flex items-center gap-1">
        <Skeleton width={40} height={14} radius={4} />
        <Skeleton width={56} height={14} radius={4} />
      </div>
      <Skeleton width="80%" height={10} />
    </div>
  )
}

function CodeSkeleton() {
  const widths = ['40%', '70%', '55%', '85%', '30%', '65%', '50%', '90%', '45%', '60%']
  return (
    <div className="flex flex-col gap-2.5 p-3">
      {widths.map((w, i) => <Skeleton key={i} width={w} height={11} />)}
    </div>
  )
}

// ── Step progress list ──────────────────────────────────────────────────────────

function StepStatusIcon({ status }: { status: WorkflowStepEvent['status'] }) {
  switch (status) {
    case 'running':
      return <Spinner size={10} />
    case 'success':
      return <span className="flex items-center justify-center w-[14px] h-[14px] rounded-full bg-green-400/20 text-green-400 shrink-0"><CheckIcon /></span>
    case 'failure':
      return <span className="flex items-center justify-center w-[14px] h-[14px] rounded-full bg-red-400/20 text-red-400 shrink-0"><CrossIcon /></span>
    case 'skipped':
    default:
      return <span className="flex items-center justify-center w-[14px] h-[14px] rounded-full bg-surface-raised text-[var(--tab-color)] opacity-50 shrink-0"><SkipIcon /></span>
  }
}

function groupStepsByJob(events: WorkflowStepEvent[]) {
  const jobs: { job: string; jobName: string; steps: WorkflowStepEvent[] }[] = []
  const jobIndex = new Map<string, number>()
  for (const ev of events) {
    let idx = jobIndex.get(ev.job)
    if (idx === undefined) {
      idx = jobs.length
      jobIndex.set(ev.job, idx)
      jobs.push({ job: ev.job, jobName: ev.jobName, steps: [] })
    }
    const steps = jobs[idx].steps
    const stepIdx = steps.findIndex(s => s.stepIndex === ev.stepIndex)
    if (stepIdx >= 0) steps[stepIdx] = ev
    else steps.push(ev)
  }
  return jobs
}

function StepProgressList({ events }: { events: WorkflowStepEvent[] }) {
  const jobs = useMemo(() => groupStepsByJob(events), [events])
  if (jobs.length === 0) return null

  return (
    <div className="flex flex-col gap-2 px-3 py-2 border-b border-[var(--border-color)]">
      {jobs.map(j => (
        <div key={j.job} className="flex flex-col gap-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--tab-color)] opacity-60">
            {j.jobName}
          </div>
          {j.steps.map(s => (
            <div key={s.stepIndex} className="flex items-center gap-1.5 pl-1">
              <StepStatusIcon status={s.status} />
              <span className={[
                'text-[11px] truncate',
                s.status === 'failure' ? 'text-red-400' : s.status === 'skipped' ? 'opacity-50' : 'text-[var(--tab-color-hover)]',
              ].join(' ')}>
                {s.stepName}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// ── Run panel ─────────────────────────────────────────────────────────────────

interface RunPanelProps {
  cwd:          string
  workflow:     WorkflowFile
  runnerStatus: RunnerStatus | null
}

function RunPanel({ cwd, workflow, runnerStatus }: RunPanelProps) {
  const [running,    setRunning]    = useState(false)
  const [output,     setOutput]     = useState('')
  const [exitCode,   setExitCode]   = useState<number | null>(null)
  const [stepEvents, setStepEvents] = useState<WorkflowStepEvent[]>([])
  const runIdRef  = useRef<string | null>(null)
  const outRef    = useRef<HTMLPreElement>(null)

  // Tear down any active subscriptions / running process on unmount or workflow change.
  useEffect(() => {
    return () => {
      const id = runIdRef.current
      if (id) {
        off(`workflows:output:${id}`, () => {})
        off(`workflows:done:${id}`, () => {})
        off(`workflows:step:${id}`, () => {})
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
    setStepEvents([])
    setRunning(true)

    const onOutput = (data: unknown) => {
      setOutput(prev => prev + stripAnsi(String(data)))
    }
    const onStep = (data: unknown) => {
      setStepEvents(prev => [...prev, data as WorkflowStepEvent])
    }
    const onDone = (data: unknown) => {
      const code = (data as { code?: number })?.code ?? null
      setExitCode(code)
      setRunning(false)
      off(`workflows:output:${runId}`, onOutput)
      off(`workflows:done:${runId}`, onDone)
      off(`workflows:step:${runId}`, onStep)
      runIdRef.current = null
    }

    on(`workflows:output:${runId}`, onOutput)
    on(`workflows:done:${runId}`, onDone)
    on(`workflows:step:${runId}`, onStep)

    try {
      await workflows.run(cwd, workflow.file, runId)
    } catch (e: any) {
      setOutput(prev => prev + `\nerror: ${e?.message ?? 'failed to start run'}\n`)
      setRunning(false)
      off(`workflows:output:${runId}`, onOutput)
      off(`workflows:done:${runId}`, onDone)
      off(`workflows:step:${runId}`, onStep)
      runIdRef.current = null
    }
  }, [cwd, workflow.file])

  const handleStop = useCallback(() => {
    const id = runIdRef.current
    if (id) workflows.stop(id).catch(() => {})
  }, [])

  const preparing = running && output === ''
  const bashUnavailable = runnerStatus !== null && runnerStatus.bash.available === false

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
      </div>

      {bashUnavailable && (
        <div className="px-3 py-1.5 border-b border-[var(--border-color)] shrink-0 text-[10px] text-yellow-400 opacity-90">
          Git Bash was not found — steps that default to <span className="font-mono">bash</span> may fail to run.
        </div>
      )}

      {stepEvents.length > 0 && <StepProgressList events={stepEvents} />}

      {preparing ? (
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="flex items-center gap-2 px-3 py-2.5 text-[11px] text-[var(--tab-color)]">
            <Spinner />
            <span>Preparing sandbox…</span>
          </div>
          <div className="flex flex-col gap-2 px-3">
            <Skeleton width="75%" height={10} />
            <Skeleton width="55%" height={10} />
            <Skeleton width="65%" height={10} />
          </div>
        </div>
      ) : (
        <pre
          ref={outRef}
          className="flex-1 overflow-auto m-0 p-2 text-[10.5px] font-mono leading-[1.5] text-[var(--tab-color-hover)] whitespace-pre-wrap break-all"
        >
          {output || (running ? '' : 'Click "Run Locally" to execute this workflow in a local sandbox.')}
        </pre>
      )}
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
  const [runnerStatus, setRunnerStatus] = useState<RunnerStatus | null>(null)

  useEffect(() => {
    workflows.checkRunner().then(setRunnerStatus).catch(() => setRunnerStatus(null))
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

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[var(--app-bg)] text-[var(--tab-color-hover)]">
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* ── Left: workflow list ─────────────────────────────────────────────── */}
        <div className="w-[300px] shrink-0 flex flex-col overflow-hidden border-r border-[var(--border-color)]">
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
              Array.from({ length: 5 }).map((_, i) => <WorkflowRowSkeleton key={i} />)
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
              <WorkflowRow
                key={wf.file}
                wf={wf}
                selected={selected?.file === wf.file}
                onSelect={() => openWorkflow(wf)}
              />
            ))}
          </div>
        </div>

        {/* ── Right: selected workflow details ────────────────────────────────── */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {!selected ? (
            <div className="flex items-center justify-center h-full text-[var(--tab-color)] text-[11px] opacity-50 text-center px-4">
              Select a workflow to view its details
            </div>
          ) : (
            <>
              <div className="px-3 py-2 border-b border-[var(--border-color)] shrink-0 flex flex-col gap-1.5">
                <div className="text-[12px] font-medium truncate">{selected.name}</div>
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
                    <CodeSkeleton />
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
                  <RunPanel cwd={cwd} workflow={selected} runnerStatus={runnerStatus} />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
