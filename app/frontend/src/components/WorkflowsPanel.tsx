import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import MonacoEditor from '@monaco-editor/react'
import type * as Monaco from 'monaco-editor'
import { workflows, type WorkflowFile, type RunnerStatus, type WorkflowStepEvent } from '../lib/workflows'
import {
  useWorkflowRuns, startWorkflowRun, stopWorkflowRun, downloadWorkflowRunLog,
  type WorkflowRunRecord,
} from '../lib/workflowRunsStore'
import { Skeleton } from './Skeleton'
import WorkflowEventsMap from './WorkflowEventsMap'
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

const CodeIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5.5 4L2 8l3.5 4M10.5 4L14 8l-3.5 4"/>
  </svg>
)

const ClockIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8" cy="8" r="6.25"/>
    <path d="M8 4.5V8.3l2.4 1.4"/>
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
          Click &ldquo;Run&rdquo; to execute this workflow in a local sandbox.
        </div>
      )}
    </div>
  )
}

// ── Run controls (header) ─────────────────────────────────────────────────────

function useLatestRun(allRuns: WorkflowRunRecord[], cwd: string, file: string | undefined) {
  return useMemo(() => {
    if (!file) return undefined
    let latest: WorkflowRunRecord | undefined
    for (const r of allRuns) {
      if (r.cwd === cwd && r.file === file) {
        if (!latest || r.startedAt > latest.startedAt) latest = r
      }
    }
    return latest
  }, [allRuns, cwd, file])
}

interface RunControlsProps {
  cwd:      string
  workflow: WorkflowFile
  run?:     WorkflowRunRecord
}

function RunControls({ cwd, workflow, run }: RunControlsProps) {
  const running = run?.status === 'running'

  const handleClick = useCallback(() => {
    if (running) {
      if (run) stopWorkflowRun(run.runId)
    } else {
      startWorkflowRun(cwd, workflow.file, workflow.name)
    }
  }, [running, run, cwd, workflow.file, workflow.name])

  return (
    <div className="wf-run-controls">
      {!running && run && (
        <span className={`wf-pill ${run.status === 'success' ? 'wf-pill--success' : 'wf-pill--failure'}`}>
          {run.status === 'success' ? <CheckIcon /> : <CrossIcon />}
          {run.status === 'success' ? 'Passed' : 'Failed'}
        </span>
      )}
      <button
        onClick={handleClick}
        className={`wf-run-btn${running ? ' wf-run-btn--running' : ''}`}
        title={running ? 'Click to stop' : 'Run workflow locally'}
      >
        <span className="wf-run-btn__label">
          {running ? <><Spinner size={13} /> Running…</> : <><PlayIcon /> Run</>}
        </span>
      </button>
    </div>
  )
}

// ── History ────────────────────────────────────────────────────────────────────

function formatRunTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function RunHistory({ cwd, file }: { cwd: string; file: string }) {
  const allRuns = useWorkflowRuns()
  const runs = useMemo(
    () => allRuns.filter(r => r.cwd === cwd && r.file === file).sort((a, b) => b.startedAt - a.startedAt),
    [allRuns, cwd, file],
  )
  const [expanded, setExpanded] = useState<string | null>(null)

  if (runs.length === 0) {
    return (
      <div className="wf-history">
        <div className="wf-output-card__placeholder">
          No runs yet. Use the Run button above to execute this workflow.
        </div>
      </div>
    )
  }

  return (
    <div className="wf-history">
      {runs.map(r => {
        const isOpen = expanded === r.runId
        const label = r.status === 'running' ? 'Running' : r.status === 'success' ? 'Passed' : 'Failed'
        return (
          <div key={r.runId} className="wf-history__item">
            <button className="wf-history__row" onClick={() => setExpanded(isOpen ? null : r.runId)}>
              <span className={`wf-history__status wf-history__status--${r.status}`}>
                {r.status === 'running' ? <Spinner size={13} /> : r.status === 'success' ? <CheckIcon /> : <CrossIcon />}
              </span>
              <span className="wf-history__label">{label}</span>
              <span className="wf-history__time">{formatRunTime(r.startedAt)}</span>
              <span className="wf-badge">Local</span>
              <span className={`wf-history__chevron${isOpen ? ' wf-history__chevron--open' : ''}`}><ChevronRightIcon /></span>
            </button>
            {isOpen && (
              <div className="wf-history__detail">
                {r.output !== '' && (
                  <div className="wf-history__toolbar">
                    {r.exitCode !== null && (
                      <span className={`wf-pill ${r.exitCode === 0 ? 'wf-pill--success' : 'wf-pill--failure'}`}>
                        exit {r.exitCode}
                      </span>
                    )}
                    <button
                      onClick={() => void downloadWorkflowRunLog(r.runId)}
                      disabled={r.downloadState !== 'idle'}
                      className="wf-btn wf-btn--ghost ml-auto"
                    >
                      {r.downloadState === 'downloading' ? (
                        <><Spinner size={12} /> Downloading…</>
                      ) : r.downloadState === 'downloaded' ? (
                        <><CheckIcon /> Downloaded</>
                      ) : (
                        <><DownloadIcon /> Download Log</>
                      )}
                    </button>
                  </div>
                )}
                <StepTimeline events={r.stepEvents} />
                <OutputCard output={r.output} running={r.status === 'running'} preparing={r.status === 'running' && r.output === ''} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

type Section = 'code' | 'events' | 'history'

interface SelectionState {
  file:    string
  section: Section
}

// Persists which workflow/section was last open per cwd, so navigating away
// from and back to the Workflows page restores the previous view (and the
// Run button keeps showing "Running" the whole time, since its status comes
// from the global workflow-runs store rather than this panel's own state).
const lastSelection = new Map<string, SelectionState>()

export default function WorkflowsPanel({ cwd, active, monacoTheme, monacoThemeDef }: Props) {
  const [list,     setList]     = useState<WorkflowFile[]>([])
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<string | null>(() => lastSelection.get(cwd)?.file ?? null)
  const [section,  setSection]  = useState<Section>(() => lastSelection.get(cwd)?.section ?? 'code')
  const [content,  setContent]  = useState('')
  const [contentLoading, setContentLoading] = useState(false)
  const [runnerStatus, setRunnerStatus] = useState<RunnerStatus | null>(null)

  const allRuns = useWorkflowRuns()

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

  const selected = useMemo(
    () => (selectedFile ? list.find(w => w.file === selectedFile) ?? null : null),
    [list, selectedFile],
  )

  useEffect(() => {
    if (!selectedFile) { setContent(''); return }
    let cancelled = false
    setContentLoading(true)
    workflows.read(cwd, selectedFile)
      .then(r => { if (!cancelled) setContent(r.content) })
      .catch((e: any) => { if (!cancelled) setContent(`# failed to read workflow\n# ${e?.message ?? 'error'}`) })
      .finally(() => { if (!cancelled) setContentLoading(false) })
    return () => { cancelled = true }
  }, [cwd, selectedFile])

  const selectWorkflow = useCallback((wf: WorkflowFile) => {
    setSelectedFile(wf.file)
    setSection('code')
    lastSelection.set(cwd, { file: wf.file, section: 'code' })
  }, [cwd])

  const selectSection = useCallback((s: Section) => {
    setSection(s)
    if (selectedFile) lastSelection.set(cwd, { file: selectedFile, section: s })
  }, [cwd, selectedFile])

  const latestRun = useLatestRun(allRuns, cwd, selected?.file)
  const bashUnavailable = runnerStatus !== null && runnerStatus.bash.available === false

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
              selected={selectedFile === wf.file}
              onSelect={() => selectWorkflow(wf)}
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
            {bashUnavailable && (
              <div className="wf-run__warning">
                Git Bash was not found — steps that default to <span style={{ fontFamily: 'var(--font-mono)' }}>bash</span> may fail to run.
              </div>
            )}

            <div className="wf-detail-header">
              <div className="wf-detail-header__info">
                <div className="wf-detail-header__title">{selected.name}</div>
                <div className="wf-detail-header__path">{selected.path}</div>
              </div>
              <RunControls cwd={cwd} workflow={selected} run={latestRun} />
            </div>

            <div className="wf-detail-body">
              <nav className="wf-detail-nav">
                <button
                  onClick={() => selectSection('code')}
                  className={`wf-detail-nav__btn${section === 'code' ? ' wf-detail-nav__btn--active' : ''}`}
                >
                  <CodeIcon /> Code
                </button>
                <button
                  onClick={() => selectSection('events')}
                  className={`wf-detail-nav__btn${section === 'events' ? ' wf-detail-nav__btn--active' : ''}`}
                >
                  <WorkflowIcon /> Events Map
                </button>
                <button
                  onClick={() => selectSection('history')}
                  className={`wf-detail-nav__btn${section === 'history' ? ' wf-detail-nav__btn--active' : ''}`}
                >
                  <ClockIcon /> History
                </button>
              </nav>

              <div className="wf-detail-content">
                {section === 'code' && (
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
                )}

                {section === 'events' && <WorkflowEventsMap content={content} loading={contentLoading} />}

                {section === 'history' && <RunHistory cwd={cwd} file={selected.file} />}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
