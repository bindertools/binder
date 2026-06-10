import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import MonacoEditor from '@monaco-editor/react'
import type * as Monaco from 'monaco-editor'
import { workflows, type WorkflowFile, type RunnerStatus, type WorkflowStepEvent } from '../lib/workflows'
import {
  useWorkflowRuns, startWorkflowRun, stopWorkflowRun, downloadWorkflowRunLog,
} from '../lib/workflowRunsStore'
import { Skeleton } from './Skeleton'
import './WorkflowsPanel.scss'

interface Props {
  cwd:             string
  active:          boolean
  monacoTheme?:    string
  monacoThemeDef?: Monaco.editor.IStandaloneThemeData
}

// ── Icons ─────────────────────────────────────────────────────────────────────

const WorkflowIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="3.5" cy="3.5" r="2"/>
    <circle cx="12.5" cy="3.5" r="2"/>
    <circle cx="8" cy="12.5" r="2"/>
    <path d="M5.1 4.6L7 11M10.9 4.6L9 11"/>
  </svg>
)

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

function TriggerBadge({ label }: { label: string }) {
  return <span className="wf-badge">{label}</span>
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

// ── Workflow list card ────────────────────────────────────────────────────────

function WorkflowCard({ wf, selected, onSelect }: { wf: WorkflowFile; selected: boolean; onSelect: () => void }) {
  return (
    <div
      className={`wf-workflow-card${selected ? ' wf-workflow-card--selected' : ''}`}
      onClick={onSelect}
    >
      <div className="wf-workflow-card__title-row">
        <span className="wf-workflow-card__icon"><WorkflowIcon /></span>
        <span className="wf-workflow-card__title">{wf.name}</span>
        <ChevronRightIcon />
      </div>
      {wf.triggers.length > 0 && (
        <div className="wf-workflow-card__badges">
          {wf.triggers.map(t => <TriggerBadge key={t} label={t} />)}
        </div>
      )}
      <div className="wf-workflow-card__path">{wf.path}</div>
      {wf.lastCommit && (
        <div className="wf-workflow-card__commit">
          <span style={{ fontFamily: 'var(--font-mono)' }}>{wf.lastCommit.hash}</span>
          {' · '}{wf.lastCommit.message}
        </div>
      )}
    </div>
  )
}

function WorkflowCardSkeleton() {
  return (
    <div className="wf-workflow-card-skeleton">
      <div className="flex items-center gap-2.5">
        <Skeleton width={28} height={28} radius={8} />
        <Skeleton width="55%" height={13} />
      </div>
      <div className="flex items-center gap-1.5">
        <Skeleton width={50} height={18} radius={6} />
        <Skeleton width={64} height={18} radius={6} />
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

// ── Step timeline ──────────────────────────────────────────────────────────────

function StepStatusDot({ status }: { status: WorkflowStepEvent['status'] }) {
  switch (status) {
    case 'running':
      return <span className="wf-timeline__dot wf-timeline__dot--running"><Spinner size={12} /></span>
    case 'success':
      return <span className="wf-timeline__dot wf-timeline__dot--success"><CheckIcon /></span>
    case 'failure':
      return <span className="wf-timeline__dot wf-timeline__dot--failure"><CrossIcon /></span>
    case 'skipped':
    default:
      return <span className="wf-timeline__dot wf-timeline__dot--skipped"><SkipIcon /></span>
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

function StepTimeline({ events }: { events: WorkflowStepEvent[] }) {
  const jobs = useMemo(() => groupStepsByJob(events), [events])
  if (jobs.length === 0) return null

  return (
    <div className="wf-timeline-card">
      {jobs.map(j => (
        <div key={j.job}>
          <div className="wf-timeline-job__title">{j.jobName}</div>
          {j.steps.map(s => (
            <div key={s.stepIndex} className="wf-timeline__row">
              <div className="wf-timeline__rail">
                <StepStatusDot status={s.status} />
                <div className="wf-timeline__line" />
              </div>
              <div className={[
                'wf-timeline__content',
                s.status === 'failure' ? 'wf-timeline__content--failure' : '',
                s.status === 'skipped' ? 'wf-timeline__content--skipped' : '',
              ].filter(Boolean).join(' ')}>
                {s.stepName}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// ── Output card ──────────────────────────────────────────────────────────────

function OutputCard({ output, running, preparing }: { output: string; running: boolean; preparing: boolean }) {
  const outRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (outRef.current) outRef.current.scrollTop = outRef.current.scrollHeight
  }, [output])

  return (
    <div className="wf-output-card">
      <div className="wf-output-card__header">
        <span>Output</span>
        {running && <Spinner size={12} />}
      </div>
      {preparing ? (
        <div className="wf-output-card__placeholder">
          <div className="flex flex-col gap-2.5 w-full max-w-[320px]">
            <Skeleton width="75%" height={11} />
            <Skeleton width="55%" height={11} />
            <Skeleton width="65%" height={11} />
          </div>
        </div>
      ) : output ? (
        <pre ref={outRef} className="wf-output-card__body">{output}</pre>
      ) : (
        <div className="wf-output-card__placeholder">
          Click &ldquo;Run Locally&rdquo; to execute this workflow in a local sandbox.
        </div>
      )}
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
    <div className="wf-run">
      <div className="wf-run__toolbar">
        {!running ? (
          <button onClick={handleRun} className="wf-btn wf-btn--primary">
            <PlayIcon /> Run Locally
          </button>
        ) : (
          <button onClick={handleStop} className="wf-btn wf-btn--ghost">
            <StopIcon /> Stop
          </button>
        )}
        {running && (
          <span className="wf-pill wf-pill--running"><Spinner size={12} /> Running…</span>
        )}
        {!running && exitCode !== null && (
          <span className={`wf-pill ${exitCode === 0 ? 'wf-pill--success' : 'wf-pill--failure'}`}>
            exit {exitCode}
          </span>
        )}
        {!running && run && output !== '' && (
          <button
            onClick={handleDownload}
            disabled={downloadState !== 'idle'}
            className="wf-btn wf-btn--ghost ml-auto"
          >
            {downloadState === 'downloading' ? (
              <><Spinner size={12} /> Downloading…</>
            ) : downloadState === 'downloaded' ? (
              <><CheckIcon /> Downloaded</>
            ) : (
              <><DownloadIcon /> Download Log</>
            )}
          </button>
        )}
      </div>

      {bashUnavailable && (
        <div className="wf-run__warning">
          Git Bash was not found — steps that default to <span style={{ fontFamily: 'var(--font-mono)' }}>bash</span> may fail to run.
        </div>
      )}

      <StepTimeline events={stepEvents} />

      <OutputCard output={output} running={running} preparing={preparing} />
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
    void refresh()
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
    <div className="wf-page">
      <div className="wf-empty">
        <span className="wf-empty__icon"><WorkflowIcon size={32} /></span>
        Open a terminal to use Workflows
      </div>
    </div>
  )

  return (
    <div className="wf-page">
      {/* ── Left: workflow list ─────────────────────────────────────────────── */}
      <aside className="wf-sidebar">
        <div className="wf-sidebar__header">
          <span className="wf-sidebar__title">
            Workflows{list.length > 0 && <span className="wf-sidebar__count">({list.length})</span>}
          </span>
          <button className="wf-sidebar__refresh" title="Refresh" onClick={() => void refresh()} disabled={loading}>
            <RefreshIcon />
          </button>
        </div>

        <div className="wf-sidebar__list">
          {loading && list.length === 0 && (
            Array.from({ length: 4 }).map((_, i) => <WorkflowCardSkeleton key={i} />)
          )}

          {error && (
            <div className="wf-sidebar__empty">{error}</div>
          )}

          {!loading && !error && list.length === 0 && (
            <div className="wf-sidebar__empty">No workflows found in .github/workflows</div>
          )}

          {list.map(wf => (
            <WorkflowCard
              key={wf.file}
              wf={wf}
              selected={selected?.file === wf.file}
              onSelect={() => void openWorkflow(wf)}
            />
          ))}
        </div>
      </aside>

      {/* ── Right: selected workflow details ────────────────────────────────── */}
      <main className="wf-main">
        {!selected ? (
          <div className="wf-empty">
            <span className="wf-empty__icon"><WorkflowIcon size={32} /></span>
            Select a workflow to view its details
          </div>
        ) : (
          <>
            <div className="wf-hero">
              <div className="wf-hero__title-row">
                <span className="wf-hero__icon"><WorkflowIcon size={20} /></span>
                <div className="min-w-0 flex-1">
                  <div className="wf-hero__title">{selected.name}</div>
                  <div className="wf-hero__path">{selected.path}</div>
                </div>
              </div>
              {selected.triggers.length > 0 && (
                <div className="wf-hero__badges">
                  {selected.triggers.map(t => <TriggerBadge key={t} label={t} />)}
                </div>
              )}
              {selected.lastCommit && (
                <div className="wf-hero__commit">
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{selected.lastCommit.hash}</span>
                  {' · '}{selected.lastCommit.message}
                  {' · '}{selected.lastCommit.date}
                </div>
              )}
            </div>

            <div className="wf-segmented">
              {(['code', 'run'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setDetailTab(tab)}
                  className={`wf-segmented__btn${detailTab === tab ? ' wf-segmented__btn--active' : ''}`}
                >
                  {tab === 'code' ? 'Code' : 'Run'}
                </button>
              ))}
            </div>

            {detailTab === 'code' ? (
              <div className="wf-code-card">
                <div className="wf-code-card__header">{selected.path}</div>
                <div className="wf-code-card__body">
                  {contentLoading ? (
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
                  )}
                </div>
              </div>
            ) : (
              <RunPanel cwd={cwd} workflow={selected} runnerStatus={runnerStatus} />
            )}
          </>
        )}
      </main>
    </div>
  )
}
