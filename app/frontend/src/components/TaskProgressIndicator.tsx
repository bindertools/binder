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

export default function TaskProgressIndicator() {
  const { tasks, batchTotal, completedInBatch, shown } = useBackgroundTaskStore()
  const [menuOpen, setMenuOpen] = useState(false)
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

  // Close menu when indicator hides
  useEffect(() => { if (!shown) setMenuOpen(false) }, [shown])

  if (!shown) return null

  const isComplete = tasks.length === 0
  const progress = batchTotal > 0 ? completedInBatch / batchTotal : 0
  const currentTaskNum = completedInBatch + 1

  let label: string
  if (isComplete) {
    label = batchTotal === 1 ? '1 task complete' : `${batchTotal} tasks complete`
  } else if (batchTotal === 1) {
    label = 'Running 1 task'
  } else {
    label = `Running ${currentTaskNum} of ${batchTotal} tasks`
  }

  // conic-gradient pie fill; rotate so fill starts at top (12 o'clock)
  const pct = Math.round(progress * 100)
  const circleStyle: React.CSSProperties = {
    width: 14,
    height: 14,
    borderRadius: '50%',
    flexShrink: 0,
    background: isComplete
      ? '#0a84ff'
      : `conic-gradient(from -90deg, #0a84ff ${pct}%, rgba(255,255,255,0.14) ${pct}%)`,
    transition: 'background 0.3s ease',
  }

  return (
    <div
      ref={wrapRef}
      className="relative flex items-center"
      style={{ ['--wails-draggable' as any]: 'no-drag' }}
    >
      <button
        className="flex items-center gap-1.5 px-2 h-[22px] rounded text-[11px] text-[var(--tab-color)] hover:bg-surface-raised transition-[background] duration-[100ms] cursor-pointer border-0 bg-transparent font-ui whitespace-nowrap"
        onClick={() => setMenuOpen(o => !o)}
        title="Background tasks"
      >
        {!isComplete && <Spinner />}
        <span>{label}</span>
        <div style={circleStyle} />
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
          {tasks.length === 0 ? (
            <div className="px-3 py-2.5 text-[12px] text-[var(--tab-color)]">All tasks complete</div>
          ) : (
            tasks.map((task, i) => (
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
            ))
          )}
        </div>
      )}
    </div>
  )
}
