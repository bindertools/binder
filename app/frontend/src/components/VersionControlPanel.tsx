import React, { useState, useEffect, useCallback, useRef } from 'react'
import { git, type GitStatus, type GitFileEntry, type GitStash } from '../lib/git'

interface Props {
  cwd: string
  active: boolean
}

// ── Diff viewer ───────────────────────────────────────────────────────────────

function DiffViewer({ diff }: { diff: string }) {
  if (!diff) return (
    <div className="flex items-center justify-center h-full text-[var(--tab-color)] text-[11px] opacity-50">
      click a file to view diff
    </div>
  )
  const lines = diff.split('\n')
  return (
    <div className="overflow-auto h-full font-mono text-[11px] leading-[1.5]">
      {lines.map((line, i) => {
        let cls = 'text-[var(--tab-color-hover)] whitespace-pre'
        if (line.startsWith('+') && !line.startsWith('+++')) cls = 'bg-green-950/40 text-green-400 whitespace-pre'
        else if (line.startsWith('-') && !line.startsWith('---')) cls = 'bg-red-950/40 text-red-400 whitespace-pre'
        else if (line.startsWith('@@')) cls = 'text-cyan-500 whitespace-pre'
        else if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++'))
          cls = 'text-[var(--tab-color)] whitespace-pre'
        return <div key={i} className={cls}>{line || ' '}</div>
      })}
    </div>
  )
}

// ── Status code badge ─────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  M: 'text-yellow-400', A: 'text-green-400', D: 'text-red-400',
  R: 'text-blue-400',   C: 'text-blue-400',  U: 'text-orange-400',
}

function StatusBadge({ code }: { code: string }) {
  return (
    <span className={`font-mono text-[10px] w-3.5 inline-block shrink-0 ${STATUS_COLORS[code] ?? 'text-[var(--tab-color)]'}`}>
      {code}
    </span>
  )
}

// ── Section header ────────────────────────────────────────────────────────────

function SectionHeader({ label, count, children }: { label: string; count: number; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-3 py-1.5 shrink-0">
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--tab-color)] opacity-60">
        {label} {count > 0 && <span className="opacity-80">({count})</span>}
      </span>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  )
}

// ── Tiny icon button ──────────────────────────────────────────────────────────

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

// ── Text button ───────────────────────────────────────────────────────────────

function TextBtn({
  label, onClick, disabled, variant = 'ghost',
}: { label: string; onClick: () => void; disabled?: boolean; variant?: 'ghost' | 'primary' }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={[
        'px-2 py-0.5 rounded text-[11px] border-0 cursor-pointer transition-[background,color] duration-[100ms] disabled:opacity-30 disabled:cursor-not-allowed',
        variant === 'primary'
          ? 'bg-accent text-white hover:opacity-90'
          : 'bg-transparent text-[var(--tab-color)] hover:text-[var(--tab-color-hover)] hover:bg-surface-raised',
      ].join(' ')}
    >
      {label}
    </button>
  )
}

// ── File row ──────────────────────────────────────────────────────────────────

interface FileRowProps {
  file: string
  statusCode: string
  selected: boolean
  onSelect: () => void
  actionIcon: React.ReactNode
  actionTitle: string
  onAction: () => void
  actionIcon2?: React.ReactNode
  actionTitle2?: string
  onAction2?: () => void
  disabled?: boolean
}

function FileRow({
  file, statusCode, selected, onSelect,
  actionIcon, actionTitle, onAction,
  actionIcon2, actionTitle2, onAction2,
  disabled,
}: FileRowProps) {
  const name = file.split('/').pop() ?? file
  const dir  = file.includes('/') ? file.substring(0, file.lastIndexOf('/')) : ''
  return (
    <div
      className={[
        'group flex items-center gap-1.5 px-3 py-[3px] cursor-pointer select-none',
        selected ? 'bg-surface-overlay' : 'hover:bg-surface-raised',
      ].join(' ')}
      onClick={onSelect}
    >
      <StatusBadge code={statusCode} />
      <span className="flex-1 min-w-0 truncate text-[11px] text-[var(--tab-color-hover)]">
        {name}
        {dir && <span className="text-[var(--tab-color)] ml-1 opacity-60">{dir}</span>}
      </span>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
        {actionIcon2 && onAction2 && (
          <IconBtn title={actionTitle2!} onClick={onAction2} disabled={disabled}>
            {actionIcon2}
          </IconBtn>
        )}
        <IconBtn title={actionTitle} onClick={onAction} disabled={disabled}>
          {actionIcon}
        </IconBtn>
      </div>
    </div>
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────────

const PlusIcon = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <path d="M6 2v8M2 6h8"/>
  </svg>
)
const MinusIcon = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <path d="M2 6h8"/>
  </svg>
)
const DiscardIcon = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 2l8 8M10 2l-8 8"/>
  </svg>
)
const RefreshIcon = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 2a5 5 0 11-1.5 7.5"/>
    <path d="M10 2v3h-3"/>
  </svg>
)
const BranchIcon = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="4" cy="3" r="1.5"/>
    <circle cx="4" cy="13" r="1.5"/>
    <circle cx="12" cy="5" r="1.5"/>
    <path d="M4 4.5v7M4 4.5C4 7 12 7 12 6.5"/>
  </svg>
)
const PullIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 1v8M3 7l3 3 3-3"/>
    <path d="M2 11h8"/>
  </svg>
)
const PushIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 9V1M3 3l3-3 3 3"/>
    <path d="M2 11h8"/>
  </svg>
)

// ── Main component ────────────────────────────────────────────────────────────

export default function VersionControlPanel({ cwd, active }: Props) {
  const [status,      setStatus]      = useState<GitStatus | null>(null)
  const [stashes,     setStashes]     = useState<GitStash[]>([])
  const [branches,    setBranches]    = useState<string[]>([])
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState<string | null>(null)
  const [selFile,     setSelFile]     = useState<{ file: string; staged: boolean } | null>(null)
  const [diff,        setDiff]        = useState('')
  const [commitMsg,   setCommitMsg]   = useState('')
  const [stashMsg,    setStashMsg]    = useState('')
  const [pending,     setPending]     = useState(false)
  const [opMsg,       setOpMsg]       = useState('')
  const [showBranches, setShowBranches] = useState(false)
  const branchRef = useRef<HTMLDivElement>(null)

  // ── Data loading ────────────────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    if (!cwd) return
    setLoading(true)
    try {
      const [s, sl, br] = await Promise.allSettled([
        git.status(cwd),
        git.stashList(cwd),
        git.branches(cwd),
      ])
      if (s.status === 'fulfilled')  { setStatus(s.value); setError(null) }
      else                           { setError(s.reason?.message ?? 'git error'); setStatus(null) }
      if (sl.status === 'fulfilled') setStashes(sl.value.stashes)
      if (br.status === 'fulfilled') setBranches(br.value.branches)
    } finally {
      setLoading(false)
    }
  }, [cwd])

  useEffect(() => {
    if (!active) return
    refresh()
    const id = setInterval(refresh, 6000)
    return () => clearInterval(id)
  }, [active, refresh])

  // Close branch dropdown on outside click
  useEffect(() => {
    if (!showBranches) return
    const handler = (e: MouseEvent) => {
      if (branchRef.current && !branchRef.current.contains(e.target as Node))
        setShowBranches(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showBranches])

  // ── Diff loading ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!selFile || !cwd) { setDiff(''); return }
    git.diff(cwd, selFile.file, selFile.staged)
      .then(r => setDiff(r.diff))
      .catch(() => setDiff(''))
  }, [selFile, cwd])

  // ── Operation wrapper ───────────────────────────────────────────────────────

  const run = async (fn: () => Promise<{ output?: string } | Record<string, never>>) => {
    setPending(true)
    try {
      const r = await fn()
      if ('output' in r && r.output) flash(r.output)
      await refresh()
      // Clear selection if file no longer appears after the operation
    } catch (e: any) {
      flash(e?.message ?? 'error')
    } finally {
      setPending(false)
    }
  }

  const flash = (msg: string) => {
    setOpMsg(msg)
    setTimeout(() => setOpMsg(''), 4000)
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  const selectFile = (file: string, staged: boolean) => {
    setSelFile(prev =>
      prev?.file === file && prev?.staged === staged ? null : { file, staged }
    )
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (!cwd) return (
    <div className="flex items-center justify-center h-full text-[var(--tab-color)] text-[11px] opacity-50 p-4 text-center">
      Open a terminal to use Version Control
    </div>
  )

  if (error) return (
    <div className="flex flex-col items-center justify-center h-full gap-3 p-4">
      <div className="text-[var(--tab-color)] text-[11px] text-center opacity-70 max-w-[260px]">
        {error.includes('not a git repository') ? 'Not a git repository' : error}
      </div>
      <TextBtn label="Retry" onClick={refresh} />
    </div>
  )

  const staged   = status?.staged   ?? []
  const unstaged = status?.unstaged ?? []
  const untracked = status?.untracked ?? []
  const totalChanges = staged.length + unstaged.length + untracked.length

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[var(--app-bg)] text-[var(--tab-color-hover)]">

      {/* ── Branch bar ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-[var(--border-color)] shrink-0">
        <BranchIcon />
        <div className="relative flex-1 min-w-0" ref={branchRef}>
          <button
            className="flex items-center gap-1 text-[12px] font-medium text-[var(--tab-color-hover)] bg-transparent border-0 cursor-pointer hover:text-accent truncate max-w-full"
            onClick={() => setShowBranches(v => !v)}
            title="Switch branch"
          >
            <span className="truncate">{status?.branch ?? '…'}</span>
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <path d="M2 3.5l3 3 3-3"/>
            </svg>
          </button>
          {showBranches && branches.length > 0 && (
            <div className="absolute left-0 top-full mt-0.5 z-50 bg-[var(--info-bar-bg)] border border-sep-strong rounded-md py-1 min-w-[180px] shadow-overlay max-h-[240px] overflow-auto">
              {branches.map(b => (
                <button
                  key={b}
                  className={[
                    'block w-full text-left px-3 py-1.5 text-[11px] bg-transparent border-0 cursor-pointer hover:bg-surface-raised',
                    b === status?.branch ? 'text-accent font-medium' : 'text-[var(--tab-color-hover)]',
                  ].join(' ')}
                  onClick={() => {
                    setShowBranches(false)
                    if (b !== status?.branch) run(() => git.checkout(cwd, b))
                  }}
                >
                  {b === status?.branch && '• '}{b}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ahead/behind badges */}
        {(status?.ahead ?? 0) > 0 && (
          <span className="text-[10px] text-green-400 font-mono shrink-0">↑{status!.ahead}</span>
        )}
        {(status?.behind ?? 0) > 0 && (
          <span className="text-[10px] text-yellow-400 font-mono shrink-0">↓{status!.behind}</span>
        )}

        <IconBtn title="Pull" onClick={() => run(() => git.pull(cwd))} disabled={pending}>
          <PullIcon />
        </IconBtn>
        <IconBtn title="Push" onClick={() => run(() => git.push(cwd))} disabled={pending}>
          <PushIcon />
        </IconBtn>
        <IconBtn title="Refresh" onClick={refresh} disabled={loading}>
          <RefreshIcon />
        </IconBtn>
      </div>

      {/* ── Scrollable body ─────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto min-h-0">

        {loading && !status && (
          <div className="flex items-center justify-center py-8 text-[var(--tab-color)] text-[11px] opacity-50">
            loading…
          </div>
        )}

        {/* Staged */}
        {staged.length > 0 && (
          <div>
            <SectionHeader label="Staged" count={staged.length}>
              <TextBtn label="Unstage All" onClick={() => run(() => git.reset(cwd))} disabled={pending} />
            </SectionHeader>
            {staged.map(({ file, status: code }) => (
              <FileRow
                key={file + '-staged'}
                file={file}
                statusCode={code}
                selected={selFile?.file === file && selFile?.staged}
                onSelect={() => selectFile(file, true)}
                actionIcon={<MinusIcon />}
                actionTitle="Unstage"
                onAction={() => run(() => git.reset(cwd, file))}
                disabled={pending}
              />
            ))}
          </div>
        )}

        {/* Unstaged */}
        {unstaged.length > 0 && (
          <div>
            <SectionHeader label="Changes" count={unstaged.length}>
              <TextBtn label="Stage All" onClick={() => run(() => git.add(cwd))} disabled={pending} />
            </SectionHeader>
            {unstaged.map(({ file, status: code }) => (
              <FileRow
                key={file + '-unstaged'}
                file={file}
                statusCode={code}
                selected={selFile?.file === file && !selFile?.staged}
                onSelect={() => selectFile(file, false)}
                actionIcon={<DiscardIcon />}
                actionTitle="Discard"
                onAction={() => run(() => git.discard(cwd, file))}
                actionIcon2={<PlusIcon />}
                actionTitle2="Stage"
                onAction2={() => run(() => git.add(cwd, file))}
                disabled={pending}
              />
            ))}
          </div>
        )}

        {/* Untracked */}
        {untracked.length > 0 && (
          <div>
            <SectionHeader label="Untracked" count={untracked.length}>
              <TextBtn label="Stage All" onClick={() => run(() => git.add(cwd))} disabled={pending} />
            </SectionHeader>
            {untracked.map(file => (
              <FileRow
                key={file + '-untracked'}
                file={file}
                statusCode="?"
                selected={selFile?.file === file && !selFile?.staged}
                onSelect={() => selectFile(file, false)}
                actionIcon={<DiscardIcon />}
                actionTitle="Delete file"
                onAction={() => run(() => git.discard(cwd, file, true))}
                actionIcon2={<PlusIcon />}
                actionTitle2="Stage"
                onAction2={() => run(() => git.add(cwd, file))}
                disabled={pending}
              />
            ))}
          </div>
        )}

        {status && totalChanges === 0 && (
          <div className="flex items-center justify-center py-6 text-[var(--tab-color)] text-[11px] opacity-40">
            no changes
          </div>
        )}

        {/* ── Commit panel ──────────────────────────────────────────────────── */}
        <div className="border-t border-[var(--border-color)] px-3 py-2 shrink-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--tab-color)] opacity-60 mb-1.5">
            Commit
          </div>
          <textarea
            className="w-full bg-surface-raised border border-sep-strong rounded text-[11px] text-[var(--tab-color-hover)] placeholder:text-[var(--tab-color)] placeholder:opacity-40 p-1.5 resize-none focus:outline-none focus:border-accent font-ui"
            rows={3}
            placeholder="commit message…"
            value={commitMsg}
            onChange={e => setCommitMsg(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && commitMsg.trim()) {
                run(() => git.commit(cwd, commitMsg.trim()))
                setCommitMsg('')
              }
            }}
          />
          <div className="flex gap-1.5 mt-1.5">
            <TextBtn
              label="Commit"
              variant="primary"
              disabled={!commitMsg.trim() || pending}
              onClick={() => {
                const msg = commitMsg.trim()
                if (!msg) return
                run(() => git.commit(cwd, msg))
                setCommitMsg('')
              }}
            />
            <TextBtn
              label="Commit & Push"
              disabled={!commitMsg.trim() || pending}
              onClick={async () => {
                const msg = commitMsg.trim()
                if (!msg) return
                setPending(true)
                try {
                  await git.commit(cwd, msg)
                  setCommitMsg('')
                  await git.push(cwd)
                  flash('pushed')
                  await refresh()
                } catch (e: any) {
                  flash(e?.message ?? 'error')
                } finally {
                  setPending(false)
                }
              }}
            />
          </div>
        </div>

        {/* ── Stash panel ───────────────────────────────────────────────────── */}
        <div className="border-t border-[var(--border-color)]">
          <SectionHeader label="Stashes" count={stashes.length}>
            <TextBtn
              label="Stash"
              disabled={pending || totalChanges === 0}
              onClick={() => {
                run(() => git.stash(cwd, stashMsg.trim() || undefined as any))
                setStashMsg('')
              }}
            />
          </SectionHeader>
          {stashes.length > 0 && (
            <div className="px-3 mb-2 flex flex-col gap-0.5">
              {stashes.map(s => (
                <div key={s.ref} className="flex items-center gap-1.5 group">
                  <span className="flex-1 min-w-0 truncate text-[11px] text-[var(--tab-color)]" title={s.message}>
                    <span className="text-[var(--tab-color)] opacity-50 font-mono">{s.ref.replace('stash@{', '').replace('}', '')} </span>
                    {s.message}
                  </span>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
                    <IconBtn title="Pop stash" onClick={() => run(() => git.stashPop(cwd, s.ref))} disabled={pending}>
                      <PlusIcon />
                    </IconBtn>
                    <IconBtn title="Drop stash" onClick={() => run(() => git.stashDrop(cwd, s.ref))} disabled={pending}>
                      <DiscardIcon />
                    </IconBtn>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Op message ────────────────────────────────────────────────────── */}
        {opMsg && (
          <div className="mx-3 mb-2 p-2 rounded bg-surface-raised border border-sep-strong text-[10px] text-[var(--tab-color)] font-mono break-all">
            {opMsg}
          </div>
        )}

        {/* ── Diff viewer ───────────────────────────────────────────────────── */}
        <div className="border-t border-[var(--border-color)]">
          <SectionHeader label="Diff" count={0}>
            {selFile && (
              <button
                className="text-[10px] text-[var(--tab-color)] hover:text-[var(--tab-color-hover)] bg-transparent border-0 cursor-pointer"
                onClick={() => { setSelFile(null); setDiff('') }}
              >
                ✕
              </button>
            )}
          </SectionHeader>
          <div className="h-[280px] px-3 pb-3">
            <DiffViewer diff={diff} />
          </div>
        </div>

      </div>
    </div>
  )
}
