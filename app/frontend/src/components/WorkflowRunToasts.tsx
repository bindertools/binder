import React from 'react'
import {
  useWorkflowRuns, dismissWorkflowRun, downloadWorkflowRunLog, type WorkflowRunRecord,
} from '../lib/workflowRunsStore'
import './WorkflowRunToasts.scss'

// ── Icons ─────────────────────────────────────────────────────────────────────

function Spinner({ size = 16 }: { size?: number }) {
  return (
    <div
      className="wf-toast-spinner"
      style={{
        width: size, height: size,
        border: '2px solid var(--sep-strong)',
        borderTopColor: 'var(--accent)',
      }}
    />
  )
}

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

const DownloadIcon = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 1.5v7.5M3.5 6l3.5 3.5L10.5 6"/>
    <path d="M2 11.5h10"/>
  </svg>
)

const CloseIcon = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3l6 6M9 3l-6 6"/>
  </svg>
)

// ── Toast card ────────────────────────────────────────────────────────────────

function StatusBadge({ run }: { run: WorkflowRunRecord }) {
  if (run.status === 'running') return <Spinner size={18} />
  if (run.status === 'success') {
    return (
      <span className="wf-toast-badge wf-toast-badge--success">
        <CheckIcon />
      </span>
    )
  }
  return (
    <span className="wf-toast-badge wf-toast-badge--failure">
      <CrossIcon />
    </span>
  )
}

function statusLabel(run: WorkflowRunRecord): string {
  if (run.status === 'running') return 'Running…'
  if (run.status === 'success') return 'Completed successfully'
  return run.exitCode !== null ? `Failed (exit ${run.exitCode})` : 'Failed'
}

function ToastCard({ run }: { run: WorkflowRunRecord }) {
  const finished = run.status !== 'running'

  return (
    <div className={`wf-toast wf-toast--${run.status}`}>
      <div className="wf-toast__icon"><StatusBadge run={run} /></div>

      <div className="wf-toast__body">
        <div className="wf-toast__title" title={run.name}>{run.name}</div>
        <div className={`wf-toast__status wf-toast__status--${run.status}`}>{statusLabel(run)}</div>

        {finished && run.downloadState === 'downloading' && (
          <div className="wf-toast__download-status">
            <Spinner size={11} />
            <span>Downloading log…</span>
          </div>
        )}
        {finished && run.downloadState === 'downloaded' && (
          <div className="wf-toast__download-status wf-toast__download-status--done">
            <CheckIcon />
            <span>Log downloaded</span>
          </div>
        )}
      </div>

      <div className="wf-toast__actions">
        {finished && run.downloadState === 'idle' && (
          <button
            className="wf-toast__btn"
            title="Download run log"
            onClick={() => void downloadWorkflowRunLog(run.runId)}
          >
            <DownloadIcon />
          </button>
        )}
        {finished && (
          <button
            className="wf-toast__btn"
            title="Dismiss"
            onClick={() => dismissWorkflowRun(run.runId)}
          >
            <CloseIcon />
          </button>
        )}
      </div>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function WorkflowRunToasts() {
  const runs = useWorkflowRuns().filter(r => !r.dismissed)
  if (runs.length === 0) return null

  return (
    <div className="wf-toasts">
      {runs.map(r => <ToastCard key={r.runId} run={r} />)}
    </div>
  )
}
