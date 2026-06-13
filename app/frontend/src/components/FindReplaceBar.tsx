import React, { useEffect, useRef } from 'react'

interface Props {
  mode: 'find' | 'replace'
  query: string
  replacement: string
  matchCount: number
  currentIndex: number
  regex: boolean
  caseSensitive: boolean
  wholeWord: boolean
  onQueryChange: (q: string) => void
  onReplacementChange: (r: string) => void
  onToggleRegex: () => void
  onToggleCaseSensitive: () => void
  onToggleWholeWord: () => void
  onToggleMode: () => void
  onNext: () => void
  onPrev: () => void
  onReplace: () => void
  onReplaceAll: () => void
  onClose: () => void
}

const toggleClass = (active: boolean) =>
  `w-5 h-5 flex items-center justify-center rounded text-[10px] font-semibold leading-none ${
    active ? 'bg-[var(--accent)] text-black' : 'text-[var(--info-bar-color)] hover:bg-[var(--info-bar-hover-bg)]'
  }`

const iconBtnClass = 'w-5 h-5 flex items-center justify-center rounded text-[var(--info-bar-hover-color)] hover:bg-[var(--info-bar-hover-bg)] disabled:opacity-40 disabled:hover:bg-transparent'

const inputClass = 'w-[170px] bg-[var(--app-bg)] border border-[var(--border-color)] rounded px-1.5 py-0.5 text-[12px] text-[var(--info-bar-hover-color)] outline-none focus:border-[var(--accent)]'

export default function FindReplaceBar(props: Props) {
  const queryRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    queryRef.current?.focus()
    queryRef.current?.select()
  }, [props.mode])

  const onQueryKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) props.onPrev()
      else props.onNext()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      props.onClose()
    }
  }

  const onReplaceKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) props.onReplaceAll()
      else props.onReplace()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      props.onClose()
    }
  }

  return (
    <div className="absolute top-2 right-4 z-10 flex flex-col gap-1 rounded-md border border-[var(--border-color)] bg-[var(--info-bar-bg)] p-1.5 shadow-lg font-mono">
      <div className="flex items-center gap-1">
        <button
          title={props.mode === 'find' ? 'Toggle replace' : 'Toggle replace'}
          onClick={props.onToggleMode}
          className={iconBtnClass}
        >
          <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"
               style={{ transform: props.mode === 'replace' ? 'rotate(90deg)' : undefined }}>
            <path d="M6 2l6 6-6 6V2z" />
          </svg>
        </button>
        <input
          ref={queryRef}
          value={props.query}
          onChange={e => props.onQueryChange(e.target.value)}
          onKeyDown={onQueryKeyDown}
          placeholder="Find"
          className={inputClass}
        />
        <button title="Match case" onClick={props.onToggleCaseSensitive} className={toggleClass(props.caseSensitive)}>Aa</button>
        <button title="Match whole word" onClick={props.onToggleWholeWord} className={toggleClass(props.wholeWord)}>ab</button>
        <button title="Use regular expression" onClick={props.onToggleRegex} className={toggleClass(props.regex)}>.*</button>
        <span className="min-w-[64px] text-center text-[11px] text-[var(--info-bar-color)]">
          {props.matchCount === 0 ? 'No results' : `${props.currentIndex + 1} of ${props.matchCount}`}
        </span>
        <button title="Previous match (Shift+Enter)" onClick={props.onPrev} disabled={props.matchCount === 0} className={iconBtnClass}>
          <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M8 4l-6 6h12L8 4z" /></svg>
        </button>
        <button title="Next match (Enter)" onClick={props.onNext} disabled={props.matchCount === 0} className={iconBtnClass}>
          <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M8 12l6-6H2l6 6z" /></svg>
        </button>
        <button title="Close (Esc)" onClick={props.onClose} className={iconBtnClass}>
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
      {props.mode === 'replace' && (
        <div className="flex items-center gap-1">
          <div className="w-5 h-5 shrink-0" />
          <input
            value={props.replacement}
            onChange={e => props.onReplacementChange(e.target.value)}
            onKeyDown={onReplaceKeyDown}
            placeholder="Replace"
            className={inputClass}
          />
          <button title="Replace (Enter)" onClick={props.onReplace} disabled={props.matchCount === 0}
            className="h-5 px-1.5 rounded text-[11px] text-[var(--info-bar-hover-color)] hover:bg-[var(--info-bar-hover-bg)] disabled:opacity-40 disabled:hover:bg-transparent">
            Replace
          </button>
          <button title="Replace all (Ctrl+Enter)" onClick={props.onReplaceAll} disabled={props.matchCount === 0}
            className="h-5 px-1.5 rounded text-[11px] text-[var(--info-bar-hover-color)] hover:bg-[var(--info-bar-hover-bg)] disabled:opacity-40 disabled:hover:bg-transparent">
            All
          </button>
        </div>
      )}
    </div>
  )
}
