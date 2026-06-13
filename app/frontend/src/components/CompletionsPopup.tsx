import React, { useEffect, useRef } from 'react'

export interface CompletionItem {
  label: string
  kind: string
  insertText: string
}

interface Props {
  items: CompletionItem[]
  index: number
  x: number
  y: number
  onSelect: (i: number) => void
  onAccept: (i: number) => void
}

// Single-letter, color-coded kind badges (VS Code-style completion icons,
// simplified to text since we don't ship an icon font for this).
const KIND_BADGES: Record<string, { ch: string; color: string }> = {
  function:  { ch: 'f', color: '#dcdcaa' },
  class:     { ch: 'c', color: '#4ec9b0' },
  type:      { ch: 't', color: '#4ec9b0' },
  property:  { ch: 'p', color: '#9cdcfe' },
  variable:  { ch: 'v', color: '#9cdcfe' },
  constant:  { ch: 'k', color: '#569cd6' },
  keyword:   { ch: 'w', color: '#c586c0' },
  module:    { ch: 'm', color: '#c586c0' },
}

export default function CompletionsPopup({ items, index, x, y, onSelect, onAccept }: Props) {
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = listRef.current?.children[index] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [index])

  return (
    <div
      ref={listRef}
      className="absolute z-20 max-h-[200px] w-[240px] overflow-y-auto rounded-md border border-[var(--border-color)] bg-[var(--info-bar-bg)] shadow-lg font-mono text-[12px]"
      style={{ left: x, top: y }}
    >
      {items.map((item, i) => {
        const badge = KIND_BADGES[item.kind] ?? { ch: '?', color: 'var(--info-bar-color)' }
        return (
          <div
            key={`${item.label}-${item.kind}`}
            onMouseDown={e => { e.preventDefault(); onAccept(i) }}
            onMouseEnter={() => onSelect(i)}
            className={`flex items-center gap-2 px-2 py-0.5 cursor-pointer ${
              i === index ? 'bg-[var(--accent)] text-black' : 'text-[var(--info-bar-hover-color)]'
            }`}
          >
            <span className="w-3 shrink-0 text-center font-semibold" style={{ color: i === index ? undefined : badge.color }}>
              {badge.ch}
            </span>
            <span className="overflow-hidden text-ellipsis whitespace-nowrap">{item.label}</span>
          </div>
        )
      })}
    </div>
  )
}
