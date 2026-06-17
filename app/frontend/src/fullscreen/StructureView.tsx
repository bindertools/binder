import React, { useMemo, useRef, useState, useCallback } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'

type SymbolKind = 'class' | 'function' | 'method' | 'constructor' | 'interface' | 'enum' | 'struct' | 'type'

export interface SymbolNode {
  name: string
  kind: SymbolKind
  line: number
  children: SymbolNode[]
}

interface Props {
  content: string
  language: string
  onGotoLine: (line: number) => void
}

const JS_RESERVED = new Set([
  'if','else','for','while','do','switch','case','break','continue','return',
  'throw','try','catch','finally','new','delete','typeof','instanceof','void',
  'await','yield','import','export','default','from','of','in','as',
])

interface RawSym { name: string; kind: SymbolKind; line: number }

function extractRaw(content: string, language: string): RawSym[] {
  if (!content) return []
  const lines = content.split('\n')
  const out: RawSym[] = []
  const lang = language === 'typescript' || language === 'javascript' ? 'js' : language

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const lineNum = i + 1
    const trimmed = raw.trimStart()
    const indent = raw.length - trimmed.length

    if (lang === 'js') {
      if (indent === 0) {
        let m = trimmed.match(/^(?:export\s+(?:default\s+)?)?(?:declare\s+)?(?:abstract\s+)?class\s+(\w+)/)
        if (m) { out.push({ name: m[1], kind: 'class', line: lineNum }); continue }

        m = trimmed.match(/^(?:export\s+(?:default\s+)?)?(?:declare\s+)?(?:async\s+)?function\s*\*?\s*(\w+)\s*[(<]/)
        if (m) { out.push({ name: m[1], kind: 'function', line: lineNum }); continue }

        m = trimmed.match(/^(?:export\s+)?(?:declare\s+)?(?:const|let)\s+(\w+)(?:\s*:[^=\n]+)?\s*=\s*(?:async\s+)?(?:function|\(|[a-zA-Z_$]\w*\s*=>)/)
        if (m) { out.push({ name: m[1], kind: 'function', line: lineNum }); continue }

        m = trimmed.match(/^(?:export\s+)?(?:declare\s+)?interface\s+(\w+)/)
        if (m) { out.push({ name: m[1], kind: 'interface', line: lineNum }); continue }

        m = trimmed.match(/^(?:export\s+)?(?:const\s+)?(?:declare\s+)?enum\s+(\w+)/)
        if (m) { out.push({ name: m[1], kind: 'enum', line: lineNum }); continue }

        m = trimmed.match(/^(?:export\s+)?(?:declare\s+)?type\s+(\w+)\s*(?:<[^>]*>)?\s*=/)
        if (m) { out.push({ name: m[1], kind: 'type', line: lineNum }); continue }
      }

      if (indent >= 2) {
        const body = trimmed.replace(
          /^(?:(?:public|private|protected|static|async|override|abstract|readonly|get|set|declare)\s+)+/,
          ''
        )
        if (body.startsWith('constructor(') || body.startsWith('constructor<') || body.startsWith('constructor ')) {
          out.push({ name: 'constructor', kind: 'constructor', line: lineNum }); continue
        }
        const meth = body.match(/^([a-zA-Z_$#][\w$]*)\s*(?:<[^>]*>)?\s*\(/)
        if (meth && !JS_RESERVED.has(meth[1]) && meth[1] !== 'constructor') {
          out.push({ name: meth[1], kind: 'method', line: lineNum }); continue
        }
      }
      continue
    }

    if (lang === 'python') {
      let m = raw.match(/^class\s+(\w+)/)
      if (m) { out.push({ name: m[1], kind: 'class', line: lineNum }); continue }
      m = raw.match(/^(\s*)(?:async\s+)?def\s+(\w+)/)
      if (m) {
        out.push({ name: m[2], kind: m[1].length === 0 ? 'function' : 'method', line: lineNum })
        continue
      }
      continue
    }

    if (lang === 'go') {
      let m = raw.match(/^func\s+\(\s*[\w\s*]+\)\s+(\w+)\s*[(<]/)
      if (m) { out.push({ name: m[1], kind: 'method', line: lineNum }); continue }
      m = raw.match(/^func\s+(\w+)\s*[(<]/)
      if (m) { out.push({ name: m[1], kind: 'function', line: lineNum }); continue }
      m = raw.match(/^type\s+(\w+)\s+struct/)
      if (m) { out.push({ name: m[1], kind: 'struct', line: lineNum }); continue }
      m = raw.match(/^type\s+(\w+)\s+interface/)
      if (m) { out.push({ name: m[1], kind: 'interface', line: lineNum }); continue }
      continue
    }

    if (lang === 'rust') {
      const pfx = /^(?:pub(?:\([\w\s]+\))?\s+)?(?:async\s+)?/
      let m = raw.match(new RegExp(pfx.source + 'fn\\s+(\\w+)'))
      if (m) { out.push({ name: m[1], kind: indent >= 4 ? 'method' : 'function', line: lineNum }); continue }
      m = raw.match(new RegExp(pfx.source + 'struct\\s+(\\w+)'))
      if (m) { out.push({ name: m[1], kind: 'struct', line: lineNum }); continue }
      m = raw.match(new RegExp(pfx.source + 'enum\\s+(\\w+)'))
      if (m) { out.push({ name: m[1], kind: 'enum', line: lineNum }); continue }
      m = raw.match(new RegExp(pfx.source + 'trait\\s+(\\w+)'))
      if (m) { out.push({ name: m[1], kind: 'interface', line: lineNum }); continue }
      continue
    }

    if (lang === 'c' || lang === 'cpp') {
      let m = raw.match(/^(?:class|struct)\s+(\w+)\s*(?:[:{\n])/)
      if (m) { out.push({ name: m[1], kind: lang === 'cpp' ? 'class' : 'struct', line: lineNum }); continue }
      m = raw.match(/^(?:(?:static|inline|virtual|explicit|constexpr|extern|override)\s+)*(?:[\w:*&<>, ]+\s+)?(\w+)\s*\([^)]*\)\s*(?:const\s*)?(?:noexcept\s*)?(?:override\s*)?\{?\s*$/)
      if (m && !JS_RESERVED.has(m[1]) && !['if','for','while','switch','else','catch','do'].includes(m[1])) {
        out.push({ name: m[1], kind: 'function', line: lineNum }); continue
      }
      continue
    }

    if (lang === 'java' || lang === 'csharp' || lang === 'kotlin' || lang === 'swift') {
      const modifiers = /(?:(?:public|private|protected|static|final|abstract|sealed|open|data|inner|async|override|virtual|new|extern|unsafe|synchronized|native)\s+)*/
      let m = raw.match(new RegExp('^\\s*' + modifiers.source + '(?:class|interface|enum|record|object|struct)\\s+(\\w+)'))
      if (m) {
        const kw = raw.match(/\b(interface|enum|record|struct)\b/)
        const kind: SymbolKind = kw
          ? kw[1] === 'interface' ? 'interface'
          : kw[1] === 'enum' ? 'enum'
          : kw[1] === 'struct' ? 'struct'
          : 'class'
          : 'class'
        out.push({ name: m[1], kind, line: lineNum }); continue
      }
      m = raw.match(new RegExp('^\\s+' + modifiers.source + '(?:[\\w<>\\[\\]?,\\s]+\\s+)?(\\w+)\\s*\\([^)]*\\)\\s*(?:throws[^{]+)?\\{?\\s*$'))
      if (m && !JS_RESERVED.has(m[1]) && !['if','for','while','switch','else','catch','do','try'].includes(m[1])) {
        out.push({ name: m[1], kind: 'method', line: lineNum }); continue
      }
      continue
    }
  }

  return out
}

function buildTree(content: string, language: string): SymbolNode[] {
  const raw = extractRaw(content, language)
  const roots: SymbolNode[] = []
  let currentClass: SymbolNode | null = null

  for (const sym of raw) {
    const node: SymbolNode = { name: sym.name, kind: sym.kind, line: sym.line, children: [] }

    if (sym.kind === 'method' || sym.kind === 'constructor') {
      if (currentClass) {
        currentClass.children.push(node)
      } else {
        roots.push(node)
      }
    } else {
      roots.push(node)
      currentClass = (sym.kind === 'class' || sym.kind === 'struct') ? node : null
    }
  }

  return roots
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

export default function StructureView({ content, language, onGotoLine }: Props) {
  const roots = useMemo(() => buildTree(content, language), [content, language])
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const scrollRef = useRef<HTMLDivElement>(null)

  const flatRows = useMemo(() => flattenTree(roots, collapsed), [roots, collapsed])

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

  if (!content) return <div className="sv-empty">No file open</div>
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
              <span className={`sv-kind ${KIND_CSS[node.kind]}`}>
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
