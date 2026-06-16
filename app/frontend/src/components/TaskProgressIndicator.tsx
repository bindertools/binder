import React, { useState, useEffect, useRef } from 'react'
import { useBackgroundTaskStore } from '../lib/backgroundTaskStore'

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

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function formatRelativeTime(completedAt: number): string {
  const seconds = Math.round((Date.now() - completedAt) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  return `${Math.floor(minutes / 60)}h ago`
}

export default function TaskProgressIndicator() {
  const { tasks, completedTasks, batchTotal, completedInBatch, textShown } = useBackgroundTaskStore()
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

  // Tick every 10s to keep relative timestamps fresh while menu is open
  useEffect(() => {
    if (!menuOpen) return
    const id = setInterval(() => tick(n => n + 1), 10_000)
    return () => clearInterval(id)
  }, [menuOpen])

  const isRunning = tasks.length > 0
  const hasAnyTasks = isRunning || completedTasks.length > 0
  const currentTaskNum = completedInBatch + 1

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
          className="absolute top-[calc(100%+4px)] right-0 min-w-[220px] max-w-[320px] bg-[var(--app-bg)] border border-[var(--border-color)] rounded-md shadow-lg z-50 overflow-hidden"
          style={{ ['--wails-draggable' as any]: 'no-drag' }}
        >
          <div className="px-3 py-2 border-b border-[var(--border-color)] text-[10.5px] text-[var(--tab-color)] opacity-60 uppercase tracking-wide font-semibold">
            Background Tasks
          </div>

          {!hasAnyTasks ? (
            <div className="px-3 py-2.5 text-[12px] text-[var(--tab-color)] opacity-55">No recent tasks</div>
          ) : (
            <div className="max-h-[280px] overflow-y-auto">
              {tasks.map((task, i) => (
                <div
                  key={task.id}
                  className="flex items-center gap-2.5 px-3 py-2 border-b border-[var(--border-color)] last:border-b-0"
                >
                  <Spinner size={12} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] text-[var(--tab-color-hover)] truncate">{task.label}</div>
                    <div className="text-[10.5px] text-[var(--tab-color)] opacity-55">
                      Task {completedInBatch + i + 1} of {batchTotal}
                    </div>
                  </div>
                </div>
              ))}
              {completedTasks.map(task => (
                <div
                  key={task.id}
                  className="flex items-center gap-2.5 px-3 py-2 border-b border-[var(--border-color)] last:border-b-0"
                >
                  <CheckIcon />
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
