import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import MonacoEditor from '@monaco-editor/react'
import type * as Monaco from 'monaco-editor'
import { workflows, type WorkflowFile, type RunnerStatus, type WorkflowStepEvent } from '../lib/workflows'
import {
  useWorkflowRuns, startWorkflowRun, stopWorkflowRun, downloadWorkflowRunLog,
} from '../lib/workflowRunsStore'
import { Skeleton } from './Skeleton'

interface Props {
  cwd:             string
  active:          boolean
  monacoTheme?:    string
  monacoThemeDef?: Monaco.editor.IStandaloneThemeData
}

// ── Icons ─────────────────────────────────────────────────────────────────────

const RefreshIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 2a5 5 0 11-1.5 7.5"/>
    <path d="M10 2v3h-3"/>
  </svg>
)

const ChevronRightIcon = () => (
  <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-50">
    <path d="M3.5 2l3 3-3 3"/>
  </svg>
)

const PlayIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" stroke="none">
    <path d="M3 2l7 4-7 4V2z"/>
  </svg>
)

const StopIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" stroke="none">
    <rect x="2.5" y="2.5" width="7" height="7" rx="1"/>
  </svg>
)

const CheckIcon = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.5 6.5l2.5 2.5 4.5-5.5"/>
  </svg>
)

const CrossIcon = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3l6 6M9 3l-6 6"/>
  </svg>
)

const SkipIcon = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.5 6h7"/>
  </svg>
)

const DownloadIcon = () => (
  <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 1.5v7.5M3.5 6l3.5 3.5L10.5 6"/>
    <path d="M2 11.5h10"/>
  </svg>
)

// ── Small UI bits ─────────────────────────────────────────────────────────────

function IconBtn({
  title, onClick, disabled, children,
}: { title: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={e => { e.stopPropagation(); onClick() }}
      className="flex items-center justify-center w-6 h-6 rounded text-[var(--tab-color)] hover:text-[var(--tab-color-hover)] hover:bg-surface-raised border-0 bg-transparent cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed transition-[background,color] duration-[100ms]"
    >
      {children}
    </button>
  )
}

function TriggerBadge({ label }: { label: string }) {
  return (
    <span className="px-2 py-[2px] rounded text-[10px] font-mono uppercase tracking-wide bg-surface-raised text-[var(--tab-color)] border border-sep">
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
        'group flex flex-col gap-1.5 px-4 py-3 cursor-pointer select-none border-b border-[var(--border-color)]',
        selected ? 'bg-surface-raised' : 'hover:bg-surface-raised',
      ].join(' ')}
      onClick={onSelect}
    >
      <div className="flex items-center gap-1.5">
        <span className="flex-1 min-w-0 truncate text-[13px] font-medium text-[var(--tab-color-hover)]">
          {wf.name}
        </span>
        <ChevronRightIcon />
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {wf.triggers.length === 0 && (
          <span className="text-[10.5px] text-[var(--tab-color)] opacity-40">no triggers detected</span>
        )}
        {wf.triggers.map(t => <TriggerBadge key={t} label={t} />)}
      </div>
      <div className="text-[10.5px] text-[var(--tab-color)] opacity-60 truncate font-mono">
        {wf.path}
      </div>
      {wf.lastCommit && (
        <div className="text-[10.5px] text-[var(--tab-color)] opacity-50 truncate leading-relaxed">
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
    <div className="flex flex-col gap-2 px-4 py-3 border-b border-[var(--border-color)]">
      <Skeleton width="60%" height={13} />
      <div className="flex items-center gap-1.5">
        <Skeleton width={44} height={16} radius={4} />
        <Skeleton width={60} height={16} radius={4} />
      </div>
      <Skeleton width="80%" height={11} />
    </div>
  )
}

function CodeSkeleton() {
  const widths = ['40%', '70%', '55%', '85%', '30%', '65%', '50%', '90%', '45%', '60%']
  return (
    <div className="flex flex-col gap-3 p-4">
      {widths.map((w, i) => <Skeleton key={i} width={w} height={12} />)}
    </div>
  )
}

// ── Step progress list ──────────────────────────────────────────────────────────

function StepStatusIcon({ status }: { status: WorkflowStepEvent['status'] }) {
  switch (status) {
    case 'running':
      return <Spinner size={12} />
    case 'success':
      return <span className="flex items-center justify-center w-[16px] h-[16px] rounded-full bg-green-400/20 text-green-400 shrink-0"><CheckIcon /></span>
    case 'failure':
      return <span className="flex items-center justify-center w-[16px] h-[16px] rounded-full bg-red-400/20 text-red-400 shrink-0"><CrossIcon /></span>
    case 'skipped':
    default:
      return <span className="flex items-center justify-center w-[16px] h-[16px] rounded-full bg-surface-raised text-[var(--tab-color)] opacity-50 shrink-0"><SkipIcon /></span>
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
    <div className="flex flex-col gap-4 px-4 py-3 border-b border-[var(--border-color)]">
      {jobs.map(j => (
        <div key={j.job} className="flex flex-col gap-1.5">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[var(--tab-color)] opacity-60">
            {j.jobName}
          </div>
          {j.steps.map(s => (
            <div key={s.stepIndex} className="flex items-center gap-2 pl-1">
              <StepStatusIcon status={s.status} />
              <span className={[
                'text-[12px] truncate',
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
  const allRuns = useWorkflowRuns()
  const run = useMemo(() => {
    let latest: typeof allRuns[number] | undefined
    for (const r of allRuns) {
      if (r.cwd === cwd && r.file === workflow.file) {
        if (!latest || r.startedAt > latest.startedAt) latest = r
      }
    }
    return latest
  }, [allRuns, cwd, workflow.file])

  const outRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (outRef.current) outRef.current.scrollTop = outRef.current.scrollHeight
  }, [run?.output])

  const handleRun = useCallback(() => {
    startWorkflowRun(cwd, workflow.file, workflow.name)
  }, [cwd, workflow.file, workflow.name])

  const handleStop = useCallback(() => {
    if (run) stopWorkflowRun(run.runId)
  }, [run])

  const handleDownload = useCallback(() => {
    if (run) void downloadWorkflowRunLog(run.runId)
  }, [run])

  const running    = run?.status === 'running'
  const output     = run?.output ?? ''
  const exitCode   = run?.exitCode ?? null
  const stepEvents = run?.stepEvents ?? []
  const downloadState = run?.downloadState ?? 'idle'

  const preparing = running && output === ''
  const bashUnavailable = runnerStatus !== null && runnerStatus.bash.available === false

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-color)] shrink-0 flex-wrap">
        {!running ? (
          <button
            onClick={handleRun}
            className="flex items-center gap-2 px-3 py-1.5 rounded text-[12px] font-medium border-0 cursor-pointer bg-accent text-white hover:opacity-90 transition-opacity duration-[100ms]"
          >
            <PlayIcon /> Run Locally
          </button>
        ) : (
          <button
            onClick={handleStop}
            className="flex items-center gap-2 px-3 py-1.5 rounded text-[12px] font-medium border-0 cursor-pointer bg-transparent text-[var(--tab-color)] hover:text-[var(--tab-color-hover)] hover:bg-surface-raised transition-[background,color] duration-[100ms]"
          >
            <StopIcon /> Stop
          </button>
        )}
        {running && (
          <span className="flex items-center gap-1.5 text-[11px] text-[var(--tab-color)] opacity-70">
            <Spinner size={12} /> running…
          </span>
        )}
        {!running && exitCode !== null && (
          <span className={`text-[11px] font-mono px-2 py-1 rounded ${exitCode === 0 ? 'text-green-400 bg-green-400/10' : 'text-red-400 bg-red-400/10'}`}>
            exit {exitCode}
          </span>
        )}
        {!running && run && output !== '' && (
          <button
            onClick={handleDownload}
            disabled={downloadState !== 'idle'}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] border-0 cursor-pointer bg-transparent text-[var(--tab-color)] hover:text-[var(--tab-color-hover)] hover:bg-surface-raised disabled:opacity-50 disabled:cursor-default transition-[background,color] duration-[100ms] ml-auto"
          >
            {downloadState === 'downloading' ? (
              <><Spinner size={11} /> Downloading…</>
            ) : downloadState === 'downloaded' ? (
              <><CheckIcon /> Downloaded</>
            ) : (
              <><DownloadIcon /> Download Log</>
            )}
          </button>
        )}
      </div>

      {bashUnavailable && (
        <div className="px-4 py-2 border-b border-[var(--border-color)] shrink-0 text-[11px] text-yellow-400 opacity-90 leading-relaxed">
          Git Bash was not found — steps that default to <span className="font-mono">bash</span> may fail to run.
        </div>
      )}

      {stepEvents.length > 0 && <StepProgressList events={stepEvents} />}

      {preparing ? (
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="flex items-center gap-2.5 px-4 py-3 text-[12px] text-[var(--tab-color)]">
            <Spinner />
            <span>Preparing sandbox…</span>
          </div>
          <div className="flex flex-col gap-2.5 px-4">
            <Skeleton width="75%" height={11} />
            <Skeleton width="55%" height={11} />
            <Skeleton width="65%" height={11} />
          </div>
        </div>
      ) : (
        <pre
          ref={outRef}
          className="flex-1 overflow-auto m-0 p-4 text-[12px] font-mono leading-[1.7] text-[var(--tab-color-hover)] whitespace-pre-wrap break-all"
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
    <div className="flex items-center justify-center h-full text-[var(--tab-color)] text-[12px] opacity-50 p-4 text-center">
      Open a terminal to use Workflows
    </div>
  )

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[var(--app-bg)] text-[var(--tab-color-hover)]">
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* ── Left: workflow list ─────────────────────────────────────────────── */}
        <div className="w-[340px] shrink-0 flex flex-col overflow-hidden border-r border-[var(--border-color)]">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)] shrink-0">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--tab-color)] opacity-60">
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
              <div className="flex flex-col items-center justify-center gap-2 py-10 px-5 text-center">
                <div className="text-[var(--tab-color)] text-[12px] opacity-70 leading-relaxed">{error}</div>
              </div>
            )}

            {!loading && !error && list.length === 0 && (
              <div className="flex items-center justify-center py-10 text-[var(--tab-color)] text-[12px] opacity-50 text-center px-5 leading-relaxed">
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
            <div className="flex items-center justify-center h-full text-[var(--tab-color)] text-[12px] opacity-50 text-center px-5">
              Select a workflow to view its details
            </div>
          ) : (
            <>
              <div className="px-5 py-4 border-b border-[var(--border-color)] shrink-0 flex flex-col gap-2">
                <div className="text-[14px] font-semibold truncate">{selected.name}</div>
                <div className="text-[11px] text-[var(--tab-color)] opacity-60 truncate font-mono">{selected.path}</div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {selected.triggers.map(t => <TriggerBadge key={t} label={t} />)}
                </div>
                {selected.lastCommit && (
                  <div className="text-[11px] text-[var(--tab-color)] opacity-50 truncate leading-relaxed">
                    <span className="font-mono">{selected.lastCommit.hash}</span>
                    {' · '}{selected.lastCommit.message}
                    {' · '}{selected.lastCommit.date}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-1.5 px-3 pt-2 border-b border-[var(--border-color)] shrink-0">
                {(['code', 'run'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setDetailTab(tab)}
                    className={[
                      'px-3.5 py-1.5 text-[12px] font-medium rounded-t border-0 border-b-2 cursor-pointer transition-colors duration-[100ms] -mb-px',
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
                        fontSize: 13,
                        lineHeight: 22,
                        scrollBeyondLastLine: false,
                        wordWrap: 'on',
                        padding: { top: 12, bottom: 12 },
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
