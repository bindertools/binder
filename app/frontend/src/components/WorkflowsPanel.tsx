import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Workflow } from 'lucide-react'
import { workflows, type WorkflowFile, type RunnerStatus, type WorkflowStepEvent } from '../lib/workflows'
import {
  useWorkflowRuns, startWorkflowRun, stopWorkflowRun, downloadWorkflowRunLog,
  type WorkflowRunRecord,
} from '../lib/workflowRunsStore'
import { insertJob } from '../lib/workflowGraph'
import { Skeleton } from './Skeleton'
import GpuEditor from './GpuEditor'
import EventsMap from './EventsMap'
import SubNavTabs from './shared/SubNavTabs'
import SidebarPanel from './shared/SidebarPanel'
import { type PageSidebarNavItem } from './shared/PageSidebarNav'
import type { GpuEditorColors } from '../themes'
import './WorkflowsPanel.scss'

interface Props {
  cwd:        string
  active:     boolean
  gpuColors?: GpuEditorColors
  onEditWorkflow?: (path: string, line?: number) => void
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

const ConsoleIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/>
    <path d="M4 6.25L6.5 8.25 4 10.25M8.5 10.25h3.5"/>
  </svg>
)

const LockIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="7.25" width="10" height="6.75" rx="1.5"/>
    <path d="M5 7.25V5a3 3 0 016 0v2.25"/>
  </svg>
)

const EditIcon = () => (
  <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9.7 1.8l2.5 2.5L4.5 12 1.5 12.5 2 9.5z"/>
    <path d="M8.2 3.3l2.5 2.5"/>
  </svg>
)

// ── Small UI bits ─────────────────────────────────────────────────────────────

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

const WFSKEL = [
  { name: 62, sub: 78 }, { name: 48, sub: 64 }, { name: 72, sub: 52 },
  { name: 55, sub: 80 }, { name: 66, sub: 44 },
]

function WorkflowSidebarSkeleton() {
  return (
    <div className="flex flex-col">
      {WFSKEL.map((w, i) => (
        <div
          key={i}
          className="flex items-start gap-2.5 py-[11px] pl-[14px] pr-3 border-b border-b-[var(--sep)]"
          style={{ animationDelay: `${i * 70}ms` }}
        >
          <Skeleton width={14} height={14} radius="50%" />
          <div className="flex flex-col gap-[5px] flex-1 min-w-0">
            <Skeleton width={`${w.name}%`} height={12} />
            <Skeleton width={`${w.sub}%`} height={10} />
          </div>
        </div>
      ))}
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

type Section = 'code' | 'history' | 'console'

interface SelectionState {
  file:    string
  section: Section
}

// Persists which workflow/section was last open per cwd, so navigating away
// from and back to the Workflows page restores the previous view (and the
// Run button keeps showing "Running" the whole time, since its status comes
// from the global workflow-runs store rather than this panel's own state).
const lastSelection = new Map<string, SelectionState>()

export default function WorkflowsPanel({ cwd, active, gpuColors, onEditWorkflow }: Props) {
  const [list,     setList]     = useState<WorkflowFile[]>([])
  const [loading,  setLoading]  = useState(false)
  const [checking, setChecking] = useState(false)
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

  // `background` refreshes don't show the skeleton or clobber error/loading
  // state — they just silently update the list (and the open file's content,
  // if it changed) and flash the small "checking" indicator next to the count.
  const refresh = useCallback(async (opts?: { background?: boolean }) => {
    if (!cwd) return
    const background = opts?.background ?? false
    if (background) setChecking(true)
    else setLoading(true)
    try {
      const r = await workflows.list(cwd)
      setList(r.workflows)
      if (!background) setError(null)
      if (background && selectedFile && r.workflows.some(w => w.file === selectedFile)) {
        try {
          const c = await workflows.read(cwd, selectedFile)
          setContent(prev => prev === c.content ? prev : c.content)
        } catch { /* keep showing last good content */ }
      }
    } catch (e: any) {
      if (!background) setError(e?.message ?? 'failed to list workflows')
    } finally {
      if (background) setChecking(false)
      else setLoading(false)
    }
  }, [cwd, selectedFile])

  // First activation does a full load (with skeleton). Re-entering an already-
  // loaded panel, or a cwd change, triggers a silent background re-check instead.
  const hasLoadedRef = useRef(false)
  const prevActiveRef = useRef(false)
  const prevCwdRef = useRef(cwd)

  useEffect(() => {
    if (prevCwdRef.current === cwd) return
    prevCwdRef.current = cwd
    const sel = lastSelection.get(cwd)
    setSelectedFile(sel?.file ?? null)
    setSection(sel?.section ?? 'code')
    setList([])
    setError(null)
    hasLoadedRef.current = false
  }, [cwd])

  useEffect(() => {
    if (!active || !cwd) { prevActiveRef.current = active; return }
    if (!hasLoadedRef.current) {
      hasLoadedRef.current = true
      void refresh()
    } else if (!prevActiveRef.current) {
      void refresh({ background: true })
    }
    prevActiveRef.current = active
  }, [active, cwd, refresh])

  // While the page is open, periodically re-check for new/changed workflows.
  useEffect(() => {
    if (!active || !cwd) return
    const id = window.setInterval(() => { void refresh({ background: true }) }, 60000)
    return () => window.clearInterval(id)
  }, [active, cwd, refresh])

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

  const handleEditWorkflow = useCallback(() => {
    if (!selected || !onEditWorkflow) return
    onEditWorkflow(`${cwd.replace(/\\/g, '/')}/${selected.path}`)
  }, [selected, cwd, onEditWorkflow])

  const jumpToLine = useCallback((line: number) => {
    if (!selected || !onEditWorkflow) return
    onEditWorkflow(`${cwd.replace(/\\/g, '/')}/${selected.path}`, line)
  }, [selected, cwd, onEditWorkflow])

  // Events Map editing (add process / link / set condition) computes the
  // new YAML text itself, then hands it here to persist — applied
  // optimistically so the map updates immediately, with a re-read to
  // resync if the write fails.
  const mutateWorkflow = useCallback((newContent: string) => {
    if (!selected) return
    setContent(newContent)
    const absPath = `${cwd.replace(/\\/g, '/')}/${selected.path}`
    workflows.write(absPath, newContent).catch(() => {
      workflows.read(cwd, selected.file).then(r => setContent(r.content)).catch(() => {})
    })
  }, [cwd, selected])

  const handleAddProcess = useCallback(() => {
    const name = window.prompt('Name for the new process:', 'New process')
    if (!name?.trim()) return
    mutateWorkflow(insertJob(content, name.trim()).content)
  }, [content, mutateWorkflow])

  // Drag-resizable divider between the code editor and the events map, both
  // now living side by side in the merged "Code" section.
  const [splitRatio, setSplitRatio] = useState(0.45)
  const splitRef = useRef<HTMLDivElement>(null)
  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const container = splitRef.current
    if (!container) return
    const onMove = (mv: MouseEvent) => {
      const rect = container.getBoundingClientRect()
      const ratio = (mv.clientX - rect.left) / rect.width
      setSplitRatio(Math.max(0.2, Math.min(0.8, ratio)))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

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
      <SidebarPanel
        title="Workflows"
        headerRight={
          <div className="flex items-center gap-2">
            {list.length > 0 && !checking && (
              <span className="text-[11px] text-[var(--info-bar-color)] opacity-55">{list.length}</span>
            )}
            {checking && <Spinner size={10} />}
            <button
              className="flex items-center p-1 rounded text-[var(--info-bar-color)] hover:text-[var(--info-bar-hover-color)] hover:bg-[var(--surface-raised)] transition-colors disabled:opacity-30"
              title="Refresh"
              onClick={() => void refresh()}
              disabled={loading}
            >
              <RefreshIcon />
            </button>
          </div>
        }
        items={(!loading && !error && list.length > 0) ? list.map((wf): PageSidebarNavItem => ({
          id: wf.file,
          label: wf.name,
          icon: <WorkflowIcon />,
          badge: wf.triggers.length > 0 ? (
            <span className="text-[9.5px] font-mono text-[var(--info-bar-color)] opacity-45 shrink-0">
              {wf.triggers[0]}{wf.triggers.length > 1 ? ` +${wf.triggers.length - 1}` : ''}
            </span>
          ) : undefined,
          subtitle: wf.path,
        })) : []}
        activeId={selectedFile}
        onSelect={(!loading && !error && list.length > 0) ? (id => {
          const wf = list.find(w => w.file === id)
          if (wf) selectWorkflow(wf)
        }) : undefined}
        emptyMessage={!loading && !error ? 'No workflows found in .github/workflows' : undefined}
      >
        {loading && list.length === 0
          ? <WorkflowSidebarSkeleton />
          : error
            ? <div className="px-3.5 py-3 text-[12px] text-[var(--color-error)]">{error}</div>
            : undefined
        }
      </SidebarPanel>

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
                Git Bash was not found. Steps that default to <span style={{ fontFamily: 'var(--font-mono)' }}>bash</span> may fail to run.
              </div>
            )}

            <div className="wf-detail-header">
              <div className="wf-detail-header__title">{selected.name}</div>
            </div>

            <div className="wf-detail-body">
              <div className="wf-detail-subnav">
                <RunControls cwd={cwd} workflow={selected} run={latestRun} />
                <SubNavTabs
                  items={[
                    { id: 'code',    label: 'Code',    icon: <CodeIcon /> },
                    { id: 'console', label: 'Console', icon: <ConsoleIcon /> },
                    { id: 'history', label: 'History', icon: <ClockIcon /> },
                  ]}
                  activeId={section}
                  onSelect={id => selectSection(id as Section)}
                />
              </div>

              <div className="wf-detail-content">
                {section === 'code' && (
                  <div className="wf-code-events">
                    <div className="wf-code-events__bar">
                      <span className="wf-code-events__path">{selected.path}</span>
                      <div className="wf-code-events__actions">
                        <button
                          className="wf-btn wf-btn--ghost wf-code-events__action-btn"
                          onClick={handleAddProcess}
                          title="Add a new process to this workflow"
                        >
                          <Workflow size={12} strokeWidth={1.8} /> Add process
                        </button>
                        <button
                          className="wf-btn wf-btn--ghost wf-code-events__action-btn"
                          onClick={handleEditWorkflow}
                          disabled={!onEditWorkflow}
                          title="Open this workflow file in the code editor"
                        >
                          <EditIcon /> Edit Workflow
                        </button>
                      </div>
                    </div>
                    <div className="wf-code-events__split" ref={splitRef}>
                      <div className="wf-code-events__pane" style={{ width: `calc(${splitRatio * 100}% - 2px)` }}>
                        {contentLoading ? (
                          <CodeSkeleton />
                        ) : (
                          <GpuEditor
                            filePath={`${cwd.replace(/\\/g, '/')}/${selected.path}`}
                            colors={gpuColors}
                            readOnly
                          />
                        )}
                      </div>
                      <div className="wf-code-events__divider" onMouseDown={handleDividerMouseDown} />
                      <div className="wf-code-events__pane" style={{ width: `calc(${(1 - splitRatio) * 100}% - 2px)` }}>
                        <EventsMap
                          content={content}
                          loading={contentLoading}
                          stepEvents={latestRun?.stepEvents}
                          onEdit={onEditWorkflow ? jumpToLine : undefined}
                          onChange={mutateWorkflow}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {section === 'history' && <RunHistory cwd={cwd} file={selected.file} />}

                {section === 'console' && (
                  latestRun ? (
                    <div className="wf-console">
                      <StepTimeline events={latestRun.stepEvents} />
                      <OutputCard
                        output={latestRun.output}
                        running={latestRun.status === 'running'}
                        preparing={latestRun.status === 'running' && latestRun.output === ''}
                      />
                    </div>
                  ) : (
                    <div className="wf-console">
                      <div className="wf-output-card wf-output-card--locked">
                        <div className="wf-output-card__header wf-output-card__header--locked">
                          <LockIcon size={12} />
                          <span>Console</span>
                        </div>
                        <div className="wf-output-card__placeholder wf-output-card__placeholder--locked">
                          <div className="wf-output-card__lock-icon"><LockIcon size={22} /></div>
                          No active run. Use the Run button above to start this workflow and view its live console output here.
                        </div>
                      </div>
                    </div>
                  )
                )}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
