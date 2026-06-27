import React, { useEffect, useState } from 'react'
import PageHeader from './shared/PageHeader'

interface Props {
  cwd: string
}

const IconPlus = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
    <path d="M6 2v8M2 6h8"/>
  </svg>
)

const IconX = () => (
  <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden>
    <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
  </svg>
)

interface Note {
  id:      string
  title:   string
  body:    string
  updated: number
}

type NotesByPath = Record<string, Note[]>

const STORAGE_KEY = 'binder_notepad_notes'

function loadAllNotes(): NotesByPath {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as NotesByPath) : {}
  } catch { return {} }
}

function saveAllNotes(notes: NotesByPath): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(notes)) } catch { /* ignore */ }
}

function pathKey(cwd: string): string {
  return cwd ? cwd.replace(/\\/g, '/').replace(/\/+$/, '') : '__global__'
}

// ── Notepad page ──────────────────────────────────────────────────────────────
// Each working directory gets its own independent set of notes, so jotting
// something down here is always scoped to the project/path you're in.

export default function NotepadPage({ cwd }: Props) {
  const key = pathKey(cwd)
  const [allNotes, setAllNotes] = useState<NotesByPath>(loadAllNotes)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState(false)

  const notes = allNotes[key] ?? []

  useEffect(() => {
    setSelectedId(notes[0]?.id ?? null)
    setEditingTitle(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const updateNotes = (next: Note[]) => {
    const updatedAll = { ...allNotes, [key]: next }
    setAllNotes(updatedAll)
    saveAllNotes(updatedAll)
  }

  const newNote = () => {
    const note: Note = { id: Date.now().toString(), title: 'Untitled', body: '', updated: Date.now() }
    updateNotes([note, ...notes])
    setSelectedId(note.id)
    setTimeout(() => setEditingTitle(true), 50)
  }

  const deleteNote = (id: string) => {
    const next = notes.filter(n => n.id !== id)
    updateNotes(next)
    if (selectedId === id) setSelectedId(next[0]?.id ?? null)
  }

  const updateBody = (body: string) => {
    updateNotes(notes.map(n => n.id === selectedId ? { ...n, body, updated: Date.now() } : n))
  }

  const updateTitle = (title: string) => {
    updateNotes(notes.map(n => n.id === selectedId ? { ...n, title } : n))
  }

  const selected = notes.find(n => n.id === selectedId)
  const displayPath = cwd ? cwd.replace(/\\/g, '/') : 'Global notes'

  return (
    <div className="absolute inset-0 flex flex-col bg-[var(--app-bg)] text-[var(--tab-color)] font-ui">
      <PageHeader
        title="Notepad"
        subtitle={displayPath}
        actions={
          <button
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-accent-border bg-accent-dim text-accent text-[12px] cursor-pointer hover:bg-accent/20 transition-colors"
            onClick={newNote}
          >
            <IconPlus /> New Note
          </button>
        }
      />
      <div className="flex-1 flex overflow-hidden">
        {/* Notes list */}
        <div className="w-[220px] shrink-0 border-r border-sep flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto">
            {notes.map(n => (
              <div
                key={n.id}
                className={[
                  'relative group px-3 py-2 cursor-pointer border-b border-[var(--surface-raised)] transition-colors',
                  n.id === selectedId ? 'bg-surface-overlay' : 'hover:bg-surface-raised',
                ].join(' ')}
                onClick={() => { setSelectedId(n.id); setEditingTitle(false) }}
              >
                <div className="text-[12px] truncate pr-4">{n.title || 'Untitled'}</div>
                <div className="text-[11px] opacity-50 truncate mt-0.5">{n.body.slice(0, 60) || ' '}</div>
                <button
                  className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 flex items-center text-[var(--tab-color)] hover:text-error cursor-pointer bg-transparent border-0"
                  onClick={e => { e.stopPropagation(); deleteNote(n.id) }}
                  aria-label="Delete note"
                >
                  <IconX />
                </button>
              </div>
            ))}
            {notes.length === 0 && (
              <div className="text-center text-[12px] opacity-40 py-5 px-3">No notes for this path yet</div>
            )}
          </div>
        </div>

        {/* Editor */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selected ? (
            <>
              {editingTitle ? (
                <input
                  className="text-[16px] font-semibold bg-transparent border-0 border-b border-sep px-5 py-3 outline-none"
                  value={selected.title}
                  autoFocus
                  onChange={e => updateTitle(e.target.value)}
                  onBlur={() => setEditingTitle(false)}
                  onKeyDown={e => { if (e.key === 'Enter') setEditingTitle(false) }}
                />
              ) : (
                <div
                  className="text-[16px] font-semibold border-b border-sep px-5 py-3 cursor-text"
                  onClick={() => setEditingTitle(true)}
                >
                  {selected.title || 'Untitled'}
                </div>
              )}
              <textarea
                className="flex-1 bg-transparent border-0 outline-none resize-none px-5 py-4 text-[13px] leading-relaxed font-ui"
                value={selected.body}
                onChange={e => updateBody(e.target.value)}
                placeholder="Start writing…"
              />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-[12px] opacity-40">
              Select or create a note
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
