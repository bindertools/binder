import React, { useEffect, useRef, useState, useCallback } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { invoke } from '../lib/ipc'

type SymbolKind = 'class' | 'function' | 'method' | 'constructor' | 'interface' | 'enum' | 'struct' | 'type'

export interface SymbolNode {
  name: string
  kind: SymbolKind
  line: number
  children: SymbolNode[]
}

interface Props {
  filePath: string
  onGotoLine: (line: number) => void
}

interface FlatRow {
  node: SymbolNode
  depth: number
  hasChildren: boolean
  isExpanded: boolean
  parentLines: boolean[]
}

function flattenTree(nodes: SymbolNode[], collapsed: Set<number>): FlatRow[] {
  const rows: FlatRow[] = []

  function walk(list: SymbolNode[], depth: number, parentLines: boolean[]) {
    list.forEach((node, i) => {
      const isLast = i === list.length - 1
      const isExpanded = node.children.length > 0 && !collapsed.has(node.line)
      rows.push({ node, depth, hasChildren: node.children.length > 0, isExpanded, parentLines })
      if (isExpanded) {
        walk(node.children, depth + 1, [...parentLines, !isLast])
      }
    })
  }

  walk(nodes, 0, [])
  return rows
}

const KIND_CSS: Record<SymbolKind, string> = {
  class:       'sv-kind--class',
  function:    'sv-kind--fn',
  method:      'sv-kind--method',
  constructor: 'sv-kind--ctor',
  interface:   'sv-kind--iface',
  enum:        'sv-kind--enum',
  struct:      'sv-kind--struct',
  type:        'sv-kind--type',
}

function KindIcon({ kind }: { kind: SymbolKind }) {
  switch (kind) {
    case 'class':
      return <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <rect x="1" y="1" width="12" height="12" rx="2" fill="currentColor"/>
        <rect x="3.5" y="4" width="7" height="1.5" rx="0.5" fill="rgba(0,0,0,0.5)"/>
        <rect x="3.5" y="7" width="5" height="1.5" rx="0.5" fill="rgba(0,0,0,0.5)"/>
      </svg>
    case 'function':
      return <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
        <circle cx="7" cy="7" r="6"/>
        <rect x="4" y="6" width="6" height="1.5" rx="0.5" fill="rgba(0,0,0,0.5)"/>
        <rect x="4" y="6.25" width="1.5" height="5" rx="0.5" fill="rgba(0,0,0,0.5)"/>
      </svg>
    case 'method':
      return <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="2"/>
        <circle cx="7" cy="7" r="2" fill="currentColor"/>
      </svg>
    case 'constructor':
      return <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
        <polygon points="7,1.5 12.5,12 1.5,12"/>
      </svg>
    case 'interface':
      return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="1.5" y="1.5" width="11" height="11" rx="2"/>
        <line x1="4" y1="7" x2="10" y2="7"/>
        <line x1="7" y1="4" x2="7" y2="10"/>
      </svg>
    case 'enum':
      return <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
        <polygon points="7,1 13,7 7,13 1,7"/>
      </svg>
    case 'struct':
      return <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
        <rect x="1" y="1" width="5" height="5" rx="1"/>
        <rect x="8" y="1" width="5" height="5" rx="1"/>
        <rect x="1" y="8" width="5" height="5" rx="1"/>
        <rect x="8" y="8" width="5" height="5" rx="1"/>
      </svg>
    case 'type':
      return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
        <polygon points="7,1 13,7 7,13 1,7"/>
      </svg>
  }
}

const ROW_H = 22
const INDENT_SIZE = 16

export default function StructureView({ filePath, onGotoLine }: Props) {
  const [roots, setRoots] = useState<SymbolNode[]>([])
  const [ready, setReady] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!filePath) { setRoots([]); setReady(false); return }

    let cancelled = false
    setReady(false)

    async function fetchOutline(retriesLeft: number) {
      try {
        const resp = await invoke<{ symbols: SymbolNode[]; ready: boolean }>(
          'editor.outline', { path: filePath }
        )
        if (cancelled) return
        if (!resp.ready && retriesLeft > 0) {
          setTimeout(() => fetchOutline(retriesLeft - 1), 200)
          return
        }
        setRoots(resp.symbols)
        setReady(true)
      } catch {
        if (!cancelled) { setRoots([]); setReady(true) }
      }
    }

    fetchOutline(4)
    return () => { cancelled = true }
  }, [filePath])

  const flatRows = flattenTree(roots, collapsed)

  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 8,
  })

  const toggle = useCallback((line: number, e: React.MouseEvent) => {
    e.stopPropagation()
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(line)) next.delete(line)
      else next.add(line)
      return next
    })
  }, [])

  if (!filePath) return <div className="sv-empty">No file open</div>
  if (!ready) return <div className="sv-empty">Loading…</div>
  if (flatRows.length === 0) return <div className="sv-empty">No symbols found</div>

  return (
    <div ref={scrollRef} className="sv-scroll">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
        {virtualizer.getVirtualItems().map(item => {
          const row = flatRows[item.index]
          const { node, depth, hasChildren, isExpanded, parentLines } = row

          return (
            <div
              key={item.index}
              className="sv-row"
              style={{
                position: 'absolute', top: 0, left: 0, right: 0,
                height: `${item.size}px`, transform: `translateY(${item.start}px)`,
              }}
              onClick={() => onGotoLine(node.line)}
              title={`${node.kind} ${node.name} — line ${node.line}`}
            >
              {/* Vertical tree guide lines */}
              {parentLines.map((hasLine, d) =>
                hasLine ? (
                  <span
                    key={d}
                    className="sv-tree-line"
                    style={{ left: `${4 + d * INDENT_SIZE + INDENT_SIZE / 2}px` }}
                  />
                ) : null
              )}

              {/* Indent spacer */}
              {depth > 0 && <span style={{ width: depth * INDENT_SIZE, flexShrink: 0 }} />}

              {/* Chevron */}
              <span
                className="sv-chevron"
                onClick={hasChildren ? e => toggle(node.line, e) : undefined}
              >
                {hasChildren
                  ? (isExpanded
                    ? <ChevronDown size={12} strokeWidth={2.5} />
                    : <ChevronRight size={12} strokeWidth={2.5} />)
                  : null
                }
              </span>

              {/* Symbol kind icon */}
              <span className={`sv-kind ${KIND_CSS[node.kind] ?? ''}`}>
                <KindIcon kind={node.kind} />
              </span>

              {/* Symbol name */}
              <span className="sv-name">{node.name}</span>

              {/* Line number */}
              <span className="sv-line">{node.line}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
