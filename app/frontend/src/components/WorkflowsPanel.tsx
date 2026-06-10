import React, { useState, useEffect, useCallback } from 'react'
import MonacoEditor from '@monaco-editor/react'
import type * as Monaco from 'monaco-editor'
import { workflows, type WorkflowFile } from '../lib/workflows'

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

// ── Main component ────────────────────────────────────────────────────────────

export default function WorkflowsPanel({ cwd, active, monacoTheme, monacoThemeDef }: Props) {
  const [list,     setList]     = useState<WorkflowFile[]>([])
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [selected, setSelected] = useState<WorkflowFile | null>(null)
  const [content,  setContent]  = useState('')
  const [contentLoading, setContentLoading] = useState(false)

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

        <div className="flex-1 min-h-0">
          {contentLoading ? (
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
