import React, { useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

export interface SymbolEntry {
  name: string
  kind: 'class' | 'function' | 'method' | 'constructor' | 'interface' | 'enum' | 'struct' | 'type'
  line: number
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

function extractSymbols(content: string, language: string): SymbolEntry[] {
  if (!content) return []
  const lines = content.split('\n')
  const out: SymbolEntry[] = []
  const lang = language === 'typescript' || language === 'javascript' ? 'js' : language

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const lineNum = i + 1
    const trimmed = raw.trimStart()
    const indent = raw.length - trimmed.length

    if (lang === 'js') {
      // Top-level: class, function, interface, enum, type, const arrow
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

      // Class members (indented 2+)
      if (indent >= 2) {
        // Strip access modifiers before matching name
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
      // Function definition: lines at column 0 containing identifier followed by (
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
        const kind: SymbolEntry['kind'] = kw
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

const KIND_CSS: Record<SymbolEntry['kind'], string> = {
  class:       'sv-kind--class',
  function:    'sv-kind--fn',
  method:      'sv-kind--method',
  constructor: 'sv-kind--ctor',
  interface:   'sv-kind--iface',
  enum:        'sv-kind--enum',
  struct:      'sv-kind--struct',
  type:        'sv-kind--type',
}

function KindIcon({ kind }: { kind: SymbolEntry['kind'] }) {
  switch (kind) {
    case 'class':
      return <svg width="10" height="10" viewBox="0 0 14 14" fill="currentColor"><rect x="1" y="1" width="12" height="12" rx="2"/></svg>
    case 'function':
      return <svg width="10" height="10" viewBox="0 0 14 14" fill="currentColor"><circle cx="7" cy="7" r="6"/></svg>
    case 'method':
      return <svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="7" cy="7" r="5"/></svg>
    case 'constructor':
      return <svg width="10" height="10" viewBox="0 0 14 14" fill="currentColor"><polygon points="7,1 13,13 1,13"/></svg>
    case 'interface':
      return <svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2"><rect x="1" y="1" width="12" height="12" rx="2"/></svg>
    case 'enum':
      return <svg width="10" height="10" viewBox="0 0 14 14" fill="currentColor"><polygon points="7,1 13,7 7,13 1,7"/></svg>
    case 'struct':
      return <svg width="10" height="10" viewBox="0 0 14 14" fill="currentColor"><rect x="1" y="1" width="5" height="5"/><rect x="8" y="1" width="5" height="5"/><rect x="1" y="8" width="5" height="5"/><rect x="8" y="8" width="5" height="5"/></svg>
    case 'type':
      return <svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="7,1 13,7 7,13 1,7"/></svg>
  }
}

const ROW_H = 22

export default function StructureView({ content, language, onGotoLine }: Props) {
  const symbols = useMemo(() => extractSymbols(content, language), [content, language])
  const scrollRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: symbols.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 8,
  })

  if (!content) {
    return <div className="sv-empty">No file open</div>
  }

  if (symbols.length === 0) {
    return <div className="sv-empty">No symbols found</div>
  }

  return (
    <div ref={scrollRef} className="sv-scroll">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
        {virtualizer.getVirtualItems().map(item => {
          const sym = symbols[item.index]
          return (
            <div
              key={item.index}
              className="sv-row"
              style={{
                position: 'absolute', top: 0, left: 0, right: 0,
                height: `${item.size}px`, transform: `translateY(${item.start}px)`,
              }}
              onClick={() => onGotoLine(sym.line)}
              title={`${sym.kind} ${sym.name} — line ${sym.line}`}
            >
              <span className={`sv-kind ${KIND_CSS[sym.kind]}`}><KindIcon kind={sym.kind} /></span>
              <span className="sv-name">{sym.name}</span>
              <span className="sv-line">{sym.line}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
