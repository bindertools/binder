import React, { useState, useEffect, useRef } from 'react'
import { useBackgroundTaskStore } from '../lib/backgroundTaskStore'
import {
  useWorkflowRuns, dismissWorkflowRun, downloadWorkflowRunLog,
  type WorkflowRunRecord,
} from '../lib/workflowRunsStore'

function Spinner({ size = 11, borderWidth = 1.5 }: { size?: number; borderWidth?: number }) {
  return (
    <div
      className="task-progress-spinner"
      style={{
        width: size, height: size,
        border: `${borderWidth}px solid rgba(255,255,255,0.15)`,
        borderTopColor: 'var(--accent)',
      }}
    />
  )
}

function SparklesIcon({ size = 13 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
    >
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
      <path d="M20 3v4" />
      <path d="M22 5h-4" />
      <path d="M4 17v2" />
      <path d="M5 18H3" />
    </svg>
  )
}

function WfSpinner({ size = 14 }: { size?: number }) {
  return (
    <div
      className="wf-toast-spinner"
      style={{
        width: size, height: size,
        border: '2px solid var(--sep-strong)',
        borderTopColor: 'var(--accent)',
        borderRadius: '50%',
        flexShrink: 0,
      }}
    />
  )
}

function CheckIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 6.5l2.5 2.5 4.5-5.5" />
    </svg>
  )
}

function CrossIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3l6 6M9 3l-6 6" />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 1.5v7.5M3.5 6l3.5 3.5L10.5 6" />
      <path d="M2 11.5h10" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3l6 6M9 3l-6 6" />
    </svg>
  )
}

function WfStatusBadge({ run }: { run: WorkflowRunRecord }) {
  if (run.status === 'running') {
    return <WfSpinner size={16} />
  }
  if (run.status === 'success') {
    return (
      <span style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
        background: 'rgba(74,222,128,0.18)', color: 'var(--color-git-add)',
      }}>
        <CheckIcon />
      </span>
    )
  }
  return (
    <span style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
      background: 'rgba(248,113,113,0.18)', color: 'var(--color-git-remove)',
    }}>
      <CrossIcon />
    </span>
  )
}

function wfStatusLabel(run: WorkflowRunRecord): string {
  if (run.status === 'running') return 'Running…'
  if (run.status === 'success') return 'Completed successfully'
  return run.exitCode !== null ? `Failed (exit ${run.exitCode})` : 'Failed'
}

function wfStatusColor(run: WorkflowRunRecord): string {
  if (run.status === 'success') return 'var(--color-git-add)'
  if (run.status === 'failure') return 'var(--color-git-remove)'
  return 'var(--tab-color)'
}

function formatRelativeTime(ts: number): string {
  const seconds = Math.round((Date.now() - ts) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  return `${Math.floor(minutes / 60)}h ago`
}

function WorkflowRunRow({ run }: { run: WorkflowRunRecord }) {
  const finished = run.status !== 'running'
  return (
    <div className="flex items-start gap-2.5 px-3 py-2 border-b border-[var(--border-color)] last:border-b-0">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, marginTop: 1, flexShrink: 0 }}>
        <WfStatusBadge run={run} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] font-semibold text-[var(--tab-color-hover)] truncate">{run.name}</div>
        <div className="text-[11px] mt-0.5" style={{ color: wfStatusColor(run), opacity: run.status === 'running' ? 0.7 : 0.9 }}>
          {wfStatusLabel(run)}
        </div>
        {finished && run.downloadState === 'downloading' && (
          <div className="flex items-center gap-1 text-[10.5px] mt-0.5" style={{ opacity: 0.7 }}>
            <WfSpinner size={9} />
            <span>Downloading log…</span>
          </div>
        )}
        {finished && run.downloadState === 'downloaded' && (
          <div className="flex items-center gap-1 text-[10.5px] mt-0.5" style={{ color: 'var(--color-git-add)', opacity: 0.9 }}>
            <CheckIcon />
            <span>Log downloaded</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-0.5 flex-shrink-0">
        {finished && run.downloadState === 'idle' && (
          <button
            className="flex items-center justify-center w-[22px] h-[22px] border-0 rounded bg-transparent text-[var(--tab-color)] cursor-pointer hover:bg-[var(--surface-raised)] hover:text-[var(--tab-color-hover)] transition-[background,color] duration-100"
            title="Download run log"
            onClick={() => void downloadWorkflowRunLog(run.runId)}
          >
            <DownloadIcon />
          </button>
        )}
        {finished && (
          <button
            className="flex items-center justify-center w-[22px] h-[22px] border-0 rounded bg-transparent text-[var(--tab-color)] cursor-pointer hover:bg-[var(--surface-raised)] hover:text-[var(--tab-color-hover)] transition-[background,color] duration-100"
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

export default function TaskProgressIndicator() {
  const { tasks, completedTasks, batchTotal, completedInBatch, textShown } = useBackgroundTaskStore()
  const allWorkflowRuns = useWorkflowRuns()
  const workflowRuns = allWorkflowRuns.filter(r => !r.dismissed)

  const [menuOpen, setMenuOpen] = useState(false)
  const [, tick] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  // Refresh relative timestamps while menu is open
  useEffect(() => {
    if (!menuOpen) return
    const id = setInterval(() => tick(n => n + 1), 10_000)
    return () => clearInterval(id)
  }, [menuOpen])

  const isRunning = tasks.length > 0
  const currentTaskNum = completedInBatch + 1

  // Non-workflow background tasks (scans etc.) — filter out Workflow entries already shown above
  const nonWfCompletedTasks = completedTasks.filter(t => !t.label.startsWith('Workflow: '))

  const hasAnyItems = workflowRuns.length > 0 || nonWfCompletedTasks.length > 0

  let label: string
  if (!isRunning) {
    label = batchTotal === 1 ? '1 task complete' : `${batchTotal} tasks complete`
  } else if (batchTotal === 1) {
    label = 'Running 1 task'
  } else {
    label = `Running ${currentTaskNum} of ${batchTotal} tasks`
  }

  return (
    <div
      ref={wrapRef}
      className="relative flex items-center"
      style={{ ['--wails-draggable' as any]: 'no-drag' }}
    >
      <button
        className="flex items-center gap-1.5 px-2 h-[22px] rounded text-[11px] hover:bg-surface-raised transition-[background] duration-[100ms] cursor-pointer border-0 bg-transparent font-ui whitespace-nowrap"
        style={{ color: 'var(--accent)' }}
        onClick={() => setMenuOpen(o => !o)}
        title="Background tasks"
      >
        {textShown && isRunning && <Spinner />}
        {textShown && (
          <span style={{ color: 'var(--tab-color)' }}>{label}</span>
        )}
        <SparklesIcon />
      </button>

      <div className="w-px h-4 bg-sep shrink-0 mx-0.5" />

      {menuOpen && (
        <div
          className="absolute top-[calc(100%+4px)] right-0 min-w-[260px] max-w-[340px] bg-[var(--app-bg)] border border-[var(--border-color)] rounded-md shadow-lg z-50 overflow-hidden"
          style={{ ['--wails-draggable' as any]: 'no-drag' }}
        >
          <div className="px-3 py-2 border-b border-[var(--border-color)] text-[10.5px] text-[var(--tab-color)] opacity-60 uppercase tracking-wide font-semibold">
            Background Tasks
          </div>

          {!hasAnyItems ? (
            <div className="px-3 py-2.5 text-[12px] text-[var(--tab-color)] opacity-55">No recent tasks</div>
          ) : (
            <div className="max-h-[320px] overflow-y-auto">
              {workflowRuns.map(run => (
                <WorkflowRunRow key={run.runId} run={run} />
              ))}
              {nonWfCompletedTasks.map(task => (
                <div
                  key={task.id}
                  className="flex items-center gap-2.5 px-3 py-2 border-b border-[var(--border-color)] last:border-b-0"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] text-[var(--tab-color)] truncate">{task.label}</div>
                    <div className="text-[10.5px] text-[var(--tab-color)] opacity-55">
                      {formatRelativeTime(task.completedAt)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
