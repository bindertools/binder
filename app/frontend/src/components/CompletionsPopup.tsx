import React, { useEffect, useRef } from 'react'
import {
  Asterisk, Box, Component, Hash, Package, SquareFunction, Tag, Type, Variable,
} from 'lucide-react'

export interface CompletionItem {
  label: string
  kind: string
  insertText: string
  detail?: string
}

interface Props {
  items: CompletionItem[]
  index: number
  x: number
  y: number
  onSelect: (i: number) => void
  onAccept: (i: number) => void
}

// VS Code-style completion icons, color-coded by symbol kind.
const KIND_META: Record<string, { Icon: typeof Variable; color: string; label: string }> = {
  function:  { Icon: SquareFunction, color: '#dcdcaa', label: 'function' },
  class:     { Icon: Box,            color: '#4ec9b0', label: 'class' },
  type:      { Icon: Type,           color: '#4ec9b0', label: 'type' },
  property:  { Icon: Tag,            color: '#9cdcfe', label: 'property' },
  variable:  { Icon: Variable,       color: '#9cdcfe', label: 'variable' },
  constant:  { Icon: Hash,           color: '#569cd6', label: 'constant' },
  keyword:   { Icon: Asterisk,       color: '#c586c0', label: 'keyword' },
  module:    { Icon: Package,        color: '#c586c0', label: 'module' },
}
const DEFAULT_KIND_META = { Icon: Component, color: 'var(--info-bar-color)', label: 'symbol' }

export default function CompletionsPopup({ items, index, x, y, onSelect, onAccept }: Props) {
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = listRef.current?.children[index] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [index])

  return (
    <div
      ref={listRef}
      className="absolute z-20 max-h-[300px] w-[360px] overflow-y-auto rounded-md border border-[var(--border-color)] bg-[var(--info-bar-bg)] shadow-lg font-mono text-[12px]"
      style={{ left: x, top: y }}
    >
      {items.map((item, i) => {
        const meta = KIND_META[item.kind] ?? DEFAULT_KIND_META
        const Icon = meta.Icon
        const selected = i === index
        return (
          <div
            key={`${item.label}-${item.kind}`}
            onMouseDown={e => { e.preventDefault(); onAccept(i) }}
            onMouseEnter={() => onSelect(i)}
            className={`flex items-start gap-2 px-2 py-1.5 cursor-pointer border-b border-[var(--border-color)]/40 last:border-b-0 ${
              selected ? 'bg-[var(--accent)] text-black' : 'text-[var(--info-bar-hover-color)]'
            }`}
          >
            <Icon size={14} strokeWidth={2} className="shrink-0 mt-0.5" style={{ color: selected ? undefined : meta.color }} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="overflow-hidden text-ellipsis whitespace-nowrap font-semibold">{item.label}</span>
                <span className={`shrink-0 text-[10px] uppercase tracking-wide ${selected ? 'text-black/60' : 'text-[var(--info-bar-color)]'}`}>
                  {meta.label}
                </span>
              </div>
              {item.detail && (
                <div className={`mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] ${selected ? 'text-black/70' : 'text-[var(--info-bar-color)]'}`}>
                  {item.detail}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
