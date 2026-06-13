import React, { useRef, useEffect, useCallback, useState, forwardRef, useImperativeHandle } from 'react'
import { invoke } from '../lib/ipc'
import { GpuTextRenderer, hexToRgba, type RGBA } from '../lib/gpuTextRenderer'
import { computeMinimapGeometry, drawMinimap, minimapLineAt, MINIMAP_WIDTH, type MinimapGeometry } from '../lib/minimapRenderer'
import type { GpuEditorColors } from '../themes'
import FindReplaceBar from './FindReplaceBar'
import CompletionsPopup, { type CompletionItem } from './CompletionsPopup'

interface LineData { text: string; spans: [number, number, number][] }

interface SearchMatch { startLine: number; startCol: number; endLine: number; endCol: number }

interface OpenResp {
  bufferId: number
  lineCount: number
  language: string
  version: number
  styles: string[]
  existing: boolean
  eol: 'LF' | 'CRLF'
  dirty: boolean
}

interface ViewState {
  topLine?: number
  leftCol?: number
  cursorLine?: number
  cursorCol?: number
}

export interface GpuEditorHandle {
  focus: () => void
  save: () => Promise<void>
  undo: () => void
  redo: () => void
}

interface Props {
  filePath: string
  fontSize?: number
  colors?: GpuEditorColors
  readOnly?: boolean
  minimap?: boolean
  gotoLine?: number
  // Per-pane view-state key (cursor/scroll position), so two panes showing
  // the same buffer keep independent cursor/scroll. Omit for single-pane
  // consumers (backend defaults to a shared "" key).
  viewKey?: string
  // Show the internal filename/status header bar. Consumers with their own
  // tab bar + status bar (FullscreenIDE) set this to false.
  showHeader?: boolean
  onCursorChange?: (line: number, col: number) => void
  onLineCountChange?: (count: number) => void
  onDirtyChange?: (dirty: boolean) => void
  onEolChange?: (eol: 'LF' | 'CRLF') => void
}

// Fallback palette used until a theme-derived `colors` prop arrives —
// indices match the backend's kStyles table.
const DEFAULT_GPU_COLORS: GpuEditorColors = {
  styles: [
    '#cccccc', // default
    '#c586c0', // keyword
    '#ce9178', // string
    '#b5cea8', // number
    '#6a9955', // comment
    '#dcdcaa', // function
    '#4ec9b0', // type
    '#9cdcfe', // property
    '#569cd6', // constant
    '#d4d4d4', // operator
    '#d4d4d4', // punctuation
    '#9cdcfe', // variable
    '#d16969', // regexp
    '#d7ba7d', // escape
  ],
  bg: '#0d0d0d',
  gutter: '#555555',
  currentLine: '#1a1a1a',
  cursor: '#cccccc',
  selection: '#264f78',
  findMatch: '#623315',
  findMatchActive: '#a8741a',
}

interface PaintColors {
  bg: RGBA
  gutter: RGBA
  currentLine: RGBA
  cursor: RGBA
  selection: RGBA
  findMatch: RGBA
  findMatchActive: RGBA
  styles: RGBA[]
}

function buildPaintColors(c: GpuEditorColors): PaintColors {
  return {
    bg: hexToRgba(c.bg),
    gutter: hexToRgba(c.gutter),
    currentLine: hexToRgba(c.currentLine),
    cursor: hexToRgba(c.cursor),
    selection: hexToRgba(c.selection, 0.55),
    findMatch: hexToRgba(c.findMatch, 0.55),
    findMatchActive: hexToRgba(c.findMatchActive, 0.75),
    styles: c.styles.map(hex => hexToRgba(hex)),
  }
}

// A single caret + its optional selection anchor. Index 0 is the primary
// cursor (drives the current-line highlight, viewport scrolling, etc.).
interface Cursor {
  line: number
  col: number
  anchorLine?: number
  anchorCol?: number
}

// Normalized [startLine, startCol, endLine, endCol] selection for a cursor,
// or null if it has no active selection.
function rangeOf(c: Cursor): [number, number, number, number] | null {
  if (c.anchorLine === undefined || c.anchorCol === undefined) return null
  if (c.anchorLine === c.line && c.anchorCol === c.col) return null
  if (c.anchorLine < c.line || (c.anchorLine === c.line && c.anchorCol < c.col)) {
    return [c.anchorLine, c.anchorCol, c.line, c.col]
  }
  return [c.line, c.col, c.anchorLine, c.anchorCol]
}

// Drop cursors that have landed on the same position (e.g. after a
// multi-cursor edit merges two carets together).
function dedupeCursors(cursors: Cursor[]): Cursor[] {
  const seen = new Set<string>()
  const result: Cursor[] = []
  for (const c of cursors) {
    const key = `${c.line}:${c.col}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(c)
  }
  return result
}

// Highlight color for matched bracket pairs — a subtle neutral box that
// works against any theme (not theme-derived, unlike the other paint colors).
const BRACKET_MATCH_COLOR: RGBA = { r: 0.5, g: 0.5, b: 0.5, a: 0.4 }

// Auto-closing pairs: typing the opening character inserts both and places
// the cursor between them; typing the closing character "types over" an
// already-inserted closer instead of inserting a duplicate.
const AUTO_CLOSE_PAIRS: Record<string, string> = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' }
const AUTO_CLOSE_CLOSERS = new Set([')', ']', '}', '"', "'", '`'])

const OVERSCAN = 10

const FONT_FAMILY = "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Menlo, Monaco, monospace"
const MIN_FONT_SIZE = 8
const MAX_FONT_SIZE = 36

const GpuEditor = forwardRef<GpuEditorHandle, Props>(function GpuEditor({
  filePath, fontSize = 13, colors, readOnly = false, minimap = false, gotoLine, viewKey,
  showHeader = true, onCursorChange, onLineCountChange, onDirtyChange, onEolChange,
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const minimapCanvasRef = useRef<HTMLCanvasElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const rendererRef = useRef<GpuTextRenderer | null>(null)

  const bufferIdRef = useRef<number>(0)
  const lineCountRef = useRef<number>(0)
  const lineCacheRef = useRef<Map<number, LineData>>(new Map())
  const versionRef = useRef<number>(0)

  const topLineRef = useRef<number>(0)
  const leftColRef = useRef<number>(0)
  const cursorsRef = useRef<Cursor[]>([{ line: 0, col: 0 }])
  const bracketMatchRef = useRef<[[number, number], [number, number]] | null>(null)
  const visibleRowsRef = useRef<number>(1)
  const visibleColsRef = useRef<number>(1)
  const cursorVisibleRef = useRef<boolean>(true)
  const dprRef = useRef<number>(1)
  const readOnlyRef = useRef<boolean>(readOnly)
  readOnlyRef.current = readOnly
  const minimapRef = useRef<boolean>(minimap)
  minimapRef.current = minimap
  const minimapGeomRef = useRef<MinimapGeometry>({ firstLine: 0, lastLine: -1, rowHeight: 2 })
  const minimapFetchRef = useRef<(first: number, last: number) => void>(() => {})
  const minimapFetchingRef = useRef(false)
  const fontSizeRef = useRef<number>(fontSize)
  const lastGotoLineRef = useRef<number | undefined>(undefined)
  const viewKeyRef = useRef<string | undefined>(viewKey)
  viewKeyRef.current = viewKey
  const dirtyRef = useRef<boolean>(false)

  const onCursorChangeRef = useRef(onCursorChange)
  onCursorChangeRef.current = onCursorChange
  const onLineCountChangeRef = useRef(onLineCountChange)
  onLineCountChangeRef.current = onLineCountChange
  const onDirtyChangeRef = useRef(onDirtyChange)
  onDirtyChangeRef.current = onDirtyChange
  const onEolChangeRef = useRef(onEolChange)
  onEolChangeRef.current = onEolChange

  const [ready, setReady] = useState(false)
  const [status, setStatus] = useState('')

  const paintRef = useRef<PaintColors>(buildPaintColors(colors ?? DEFAULT_GPU_COLORS))

  // ── Find / replace state ─────────────────────────────────────────────────────
  const [findOpen, setFindOpen] = useState(false)
  const [findMode, setFindMode] = useState<'find' | 'replace'>('find')
  const [findQuery, setFindQuery] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [findRegex, setFindRegex] = useState(false)
  const [findCaseSensitive, setFindCaseSensitive] = useState(false)
  const [findWholeWord, setFindWholeWord] = useState(false)
  const [matchCount, setMatchCount] = useState(0)
  const [currentMatch, setCurrentMatch] = useState(-1)

  const matchesRef = useRef<SearchMatch[]>([])
  const currentMatchRef = useRef(-1)
  const findOpenRef = useRef(false)
  findOpenRef.current = findOpen
  const findQueryRef = useRef('')
  findQueryRef.current = findQuery
  const replaceTextRef = useRef('')
  replaceTextRef.current = replaceText
  const findRegexRef = useRef(false)
  findRegexRef.current = findRegex
  const findCaseSensitiveRef = useRef(false)
  findCaseSensitiveRef.current = findCaseSensitive
  const findWholeWordRef = useRef(false)
  findWholeWordRef.current = findWholeWord

  // ── Autocomplete state ───────────────────────────────────────────────────────
  const [completionOpen, setCompletionOpen] = useState(false)
  const [completionItems, setCompletionItems] = useState<CompletionItem[]>([])
  const [completionIndex, setCompletionIndex] = useState(0)
  const [completionPos, setCompletionPos] = useState({ x: 0, y: 0 })

  const completionOpenRef = useRef(false)
  completionOpenRef.current = completionOpen
  const completionItemsRef = useRef<CompletionItem[]>([])
  completionItemsRef.current = completionItems
  const completionIndexRef = useRef(0)
  completionIndexRef.current = completionIndex
  const completionDebounceRef = useRef<ReturnType<typeof setTimeout>>()

  // Notify consumers (e.g. FullscreenIDE's status bar) of the primary
  // cursor's position. Cheap to call after every cursor-affecting op.
  const notifyCursor = useCallback(() => {
    const { line, col } = cursorsRef.current[0]
    onCursorChangeRef.current?.(line, col)
  }, [])

  const notifyDirty = useCallback((dirty: boolean) => {
    if (dirtyRef.current === dirty) return
    dirtyRef.current = dirty
    onDirtyChangeRef.current?.(dirty)
  }, [])

  // ── Drawing ─────────────────────────────────────────────────────────────────

  const draw = useCallback(() => {
    const renderer = rendererRef.current
    const canvas = canvasRef.current
    if (!renderer || !canvas) return

    const cw = renderer.cellWidth
    const ch = renderer.cellHeight
    const lineCount = lineCountRef.current
    const gutterDigits = Math.max(3, String(Math.max(1, lineCount)).length)
    const gutterWidth = (gutterDigits + 1) * cw

    renderer.beginFrame(paintRef.current.bg)

    const top = topLineRef.current
    const rows = visibleRowsRef.current
    const left = leftColRef.current
    const cols = visibleColsRef.current
    const cursors = cursorsRef.current
    const { line: curLine } = cursors[0]
    const ranges = cursors.map(rangeOf).filter((r): r is [number, number, number, number] => r !== null)

    // Current-line highlight (full width, behind text)
    if (curLine >= top && curLine < top + rows) {
      const y = (curLine - top) * ch
      renderer.drawRect(0, y, canvas.clientWidth, ch, paintRef.current.currentLine)
    }

    for (let row = 0; row < rows; row++) {
      const ln = top + row
      if (ln >= lineCount) break
      const data = lineCacheRef.current.get(ln)
      const y = row * ch

      // Line number (right-aligned in gutter)
      const numStr = String(ln + 1)
      const numX = gutterWidth - (numStr.length + 1) * cw
      renderer.drawText(numX, y, numStr, paintRef.current.gutter)

      if (!data) continue

      // Selection backgrounds (one per cursor with an active selection)
      for (const [sLine, sCol, eLine, eCol] of ranges) {
        if (ln >= sLine && ln <= eLine) {
          const from = ln === sLine ? sCol : 0
          const to = ln === eLine ? eCol : data.text.length + 1
          const x0 = gutterWidth + (from - left) * cw
          const x1 = gutterWidth + (to - left) * cw
          renderer.drawRect(Math.max(gutterWidth, x0), y, Math.max(0, x1 - Math.max(gutterWidth, x0)), ch, paintRef.current.selection)
        }
      }

      // Build a per-character style array, then draw runs of matching style.
      const text = data.text
      const styleAt = new Uint8Array(text.length)
      for (const [s, e, style] of data.spans) {
        for (let i = Math.max(0, s); i < Math.min(text.length, e); i++) styleAt[i] = style
      }
      let i = 0
      while (i < text.length) {
        const st = styleAt[i]
        let j = i + 1
        while (j < text.length && styleAt[j] === st) j++
        const col = i - left
        if (col + (j - i) > 0 && col < cols) {
          const visStart = Math.max(0, col)
          const skip = visStart - col
          const segment = text.slice(i + skip, i + skip + Math.min(j - i - skip, cols - visStart))
          const x = gutterWidth + visStart * cw
          renderer.drawText(x, y, segment, paintRef.current.styles[st] ?? paintRef.current.styles[0])
        }
        i = j
      }
    }

    // Matched bracket pair highlight
    if (bracketMatchRef.current) {
      for (const [bLine, bCol] of bracketMatchRef.current) {
        if (bLine < top || bLine >= top + rows) continue
        const x = gutterWidth + (bCol - left) * cw
        const y = (bLine - top) * ch
        if (bCol - left >= 0 && bCol - left < cols) {
          renderer.drawRect(x, y, cw, ch, BRACKET_MATCH_COLOR)
        }
      }
    }

    // Find/replace match highlights
    const matches = matchesRef.current
    for (let mi = 0; mi < matches.length; mi++) {
      const m = matches[mi]
      if (m.endLine < top || m.startLine >= top + rows) continue
      const color = mi === currentMatchRef.current ? paintRef.current.findMatchActive : paintRef.current.findMatch
      for (let ln = Math.max(m.startLine, top); ln <= Math.min(m.endLine, top + rows - 1); ln++) {
        const data = lineCacheRef.current.get(ln)
        const from = ln === m.startLine ? m.startCol : 0
        const to = ln === m.endLine ? m.endCol : (data?.text.length ?? 0) + 1
        const x0 = gutterWidth + (from - left) * cw
        const x1 = gutterWidth + (to - left) * cw
        const y = (ln - top) * ch
        renderer.drawRect(Math.max(gutterWidth, x0), y, Math.max(0, x1 - Math.max(gutterWidth, x0)), ch, color)
      }
    }

    // Carets — one per cursor
    if (cursorVisibleRef.current) {
      for (const c of cursors) {
        if (c.line < top || c.line >= top + rows) continue
        const x = gutterWidth + (c.col - left) * cw
        const y = (c.line - top) * ch
        if (c.col - left >= 0 && c.col - left <= cols) {
          renderer.drawRect(x, y, 2, ch, paintRef.current.cursor)
        }
      }
    }

    renderer.endFrame()

    // Minimap overlay (separate Canvas2D, drawn after the WebGL frame)
    if (minimapRef.current) {
      const mmCanvas = minimapCanvasRef.current
      const ctx = mmCanvas?.getContext('2d')
      if (ctx && mmCanvas) {
        const dpr = dprRef.current || 1
        const mmHeight = mmCanvas.height / dpr
        const geom = computeMinimapGeometry(lineCount, mmHeight, top, rows)
        minimapGeomRef.current = geom
        ctx.save()
        ctx.scale(dpr, dpr)
        drawMinimap(
          ctx, MINIMAP_WIDTH, mmHeight,
          ln => lineCacheRef.current.get(ln),
          paintRef.current.styles, paintRef.current.bg,
          top, rows, paintRef.current.selection,
          geom,
        )
        ctx.restore()
        minimapFetchRef.current(geom.firstLine, geom.lastLine)
      }
    }
  }, [])

  // ── Data fetching ───────────────────────────────────────────────────────────

  const fetchLines = useCallback(async (start: number, end: number) => {
    if (start > end) return
    const resp = await invoke<{ version: number; start: number; lines: LineData[] }>('editor.lines', {
      bufferId: bufferIdRef.current, start, end,
    })
    resp.lines.forEach((l, idx) => lineCacheRef.current.set(resp.start + idx, l))
    draw()
  }, [draw])

  const fetchVisible = useCallback(() => {
    const top = topLineRef.current
    const rows = visibleRowsRef.current
    const lineCount = lineCountRef.current
    const start = Math.max(0, top - OVERSCAN)
    const end = Math.min(lineCount - 1, top + rows + OVERSCAN)
    const missing: number[] = []
    for (let ln = start; ln <= end; ln++) if (!lineCacheRef.current.has(ln)) missing.push(ln)
    if (missing.length === 0) return
    // Fetch the whole missing range in one call (cheap; backend recomputes spans only).
    void fetchLines(missing[0], missing[missing.length - 1])
  }, [fetchLines])

  // Lazily fetch lines needed by the minimap in chunks, redrawing as each
  // chunk arrives. Serialized via minimapFetchingRef so concurrent draw()
  // calls (scrolling, blinking) don't pile up redundant requests.
  const fetchMinimapLines = useCallback((first: number, last: number) => {
    if (minimapFetchingRef.current) return
    const CHUNK = 300
    const run = (start: number) => {
      if (start > last) { minimapFetchingRef.current = false; return }
      const end = Math.min(last, start + CHUNK - 1)
      const missing: number[] = []
      for (let ln = start; ln <= end; ln++) if (!lineCacheRef.current.has(ln)) missing.push(ln)
      if (missing.length === 0) { run(end + 1); return }
      minimapFetchingRef.current = true
      void fetchLines(missing[0], missing[missing.length - 1]).then(() => run(end + 1))
    }
    run(first)
  }, [fetchLines])
  minimapFetchRef.current = fetchMinimapLines

  // Ensure a single line is cached (for cursor-movement length checks); returns its text length.
  const ensureLine = useCallback(async (ln: number): Promise<LineData | undefined> => {
    if (ln < 0 || ln >= lineCountRef.current) return undefined
    let data = lineCacheRef.current.get(ln)
    if (!data) {
      await fetchLines(ln, ln)
      data = lineCacheRef.current.get(ln)
    }
    return data
  }, [fetchLines])

  // ── Layout ──────────────────────────────────────────────────────────────────

  const recomputeViewport = useCallback(() => {
    const renderer = rendererRef.current
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!renderer || !container || !canvas) return
    const w = container.clientWidth
    const h = container.clientHeight
    const dpr = window.devicePixelRatio || 1
    dprRef.current = dpr
    renderer.resize(w, h, dpr)
    const gutterWidth = (Math.max(3, String(Math.max(1, lineCountRef.current)).length) + 1) * renderer.cellWidth
    const minimapW = minimapRef.current ? MINIMAP_WIDTH : 0
    visibleRowsRef.current = Math.max(1, Math.ceil(h / renderer.cellHeight))
    visibleColsRef.current = Math.max(1, Math.floor((w - gutterWidth - minimapW) / renderer.cellWidth))

    const mmCanvas = minimapCanvasRef.current
    if (mmCanvas) {
      mmCanvas.width = Math.max(1, Math.round(MINIMAP_WIDTH * dpr))
      mmCanvas.height = Math.max(1, Math.round(h * dpr))
      mmCanvas.style.width = `${MINIMAP_WIDTH}px`
      mmCanvas.style.height = `${h}px`
    }

    fetchVisible()
    draw()
  }, [draw, fetchVisible])

  // ── Scrolling ───────────────────────────────────────────────────────────────

  const clampScroll = useCallback(() => {
    const maxTop = Math.max(0, lineCountRef.current - 1)
    topLineRef.current = Math.min(Math.max(0, topLineRef.current), maxTop)
    leftColRef.current = Math.max(0, leftColRef.current)
  }, [])

  const ensureCursorVisible = useCallback(() => {
    const { line, col } = cursorsRef.current[0]
    const rows = visibleRowsRef.current
    const cols = visibleColsRef.current
    if (line < topLineRef.current) topLineRef.current = line
    else if (line >= topLineRef.current + rows) topLineRef.current = line - rows + 1
    if (col < leftColRef.current) leftColRef.current = col
    else if (col >= leftColRef.current + cols) leftColRef.current = col - cols + 1
    clampScroll()
  }, [clampScroll])

  // Re-query the bracket pair surrounding the primary cursor and redraw.
  // Fire-and-forget: called after every cursor move / edit.
  const updateBracketMatch = useCallback(async () => {
    const { line, col } = cursorsRef.current[0]
    try {
      const resp = await invoke<{
        found: boolean
        anchorLine?: number; anchorCol?: number
        matchLine?: number; matchCol?: number
      }>('editor.matchBracket', { bufferId: bufferIdRef.current, line, col })
      bracketMatchRef.current = resp.found
        ? [[resp.anchorLine!, resp.anchorCol!], [resp.matchLine!, resp.matchCol!]]
        : null
    } catch {
      bracketMatchRef.current = null
    }
    draw()
  }, [draw])

  // ── Autocomplete ─────────────────────────────────────────────────────────────

  const closeCompletions = useCallback(() => {
    if (completionDebounceRef.current) clearTimeout(completionDebounceRef.current)
    if (completionOpenRef.current) setCompletionOpen(false)
  }, [])

  // Pixel position just below the primary cursor, for positioning the popup.
  const cursorPixelPos = useCallback(() => {
    const renderer = rendererRef.current
    const { line, col } = cursorsRef.current[0]
    if (!renderer) return { x: 0, y: 0 }
    const gutterDigits = Math.max(3, String(Math.max(1, lineCountRef.current)).length)
    const gutterWidth = (gutterDigits + 1) * renderer.cellWidth
    const x = gutterWidth + (col - leftColRef.current) * renderer.cellWidth
    const y = (line - topLineRef.current + 1) * renderer.cellHeight
    return { x, y }
  }, [])

  // Fetch completions for the primary cursor's position. No-op for
  // multi-cursor/selection (ambiguous insertion point).
  const requestCompletions = useCallback(async () => {
    if (readOnlyRef.current || cursorsRef.current.length > 1 || rangeOf(cursorsRef.current[0])) {
      closeCompletions()
      return
    }
    const { line, col } = cursorsRef.current[0]
    try {
      const resp = await invoke<{ items: CompletionItem[] }>('editor.completions', {
        bufferId: bufferIdRef.current, line, col,
      })
      if (resp.items.length === 0) { closeCompletions(); return }
      setCompletionItems(resp.items)
      setCompletionIndex(0)
      setCompletionPos(cursorPixelPos())
      setCompletionOpen(true)
    } catch {
      closeCompletions()
    }
  }, [closeCompletions, cursorPixelPos])

  const scheduleCompletions = useCallback(() => {
    if (completionDebounceRef.current) clearTimeout(completionDebounceRef.current)
    completionDebounceRef.current = setTimeout(() => { void requestCompletions() }, 150)
  }, [requestCompletions])

  // ── Editing ─────────────────────────────────────────────────────────────────

  // Apply one edit per cursor (some cursors may be skipped — e.g. a no-op
  // backspace at the start of the document). `ops[].idx` indexes into
  // `cursorsRef.current`; edits are sent to the backend in reverse document
  // order so earlier entries' coordinates aren't invalidated by later ones,
  // and each cursor's new position is then computed purely from its own
  // edit (safe because reverse order means no edit shifts a not-yet-applied
  // cursor's coordinates).
  const applyMultiEdit = useCallback(async (ops: {
    idx: number
    range: [number, number, number, number]
    text: string
    // Override the default "end of inserted text" cursor placement — used
    // when the caret should land inside the inserted text (auto-close pairs,
    // auto-indent between a freshly-split bracket pair). `lineOffset` is
    // added to the edit's start line; `col` is an absolute column on that line.
    cursor?: { lineOffset: number; col: number }
  }[]) => {
    if (ops.length === 0 || readOnlyRef.current) return
    const sorted = [...ops].sort((a, b) => b.range[0] - a.range[0] || b.range[1] - a.range[1])
    const edits = sorted.map(({ range: [sl, sc, el, ec], text }) => ({ startLine: sl, startCol: sc, endLine: el, endCol: ec, text }))
    const resp = await invoke<{ version: number; lineCount: number; dirtyStart: number; dirtyEnd: number }>('editor.edit', {
      bufferId: bufferIdRef.current, edits,
    })
    versionRef.current = resp.version
    lineCountRef.current = resp.lineCount
    lineCacheRef.current.clear()

    const cursors = cursorsRef.current.slice()
    for (const { idx, range: [sl, sc], text, cursor } of ops) {
      if (cursor) {
        cursors[idx] = { line: sl + cursor.lineOffset, col: cursor.col }
        continue
      }
      const lines = text.split('\n')
      cursors[idx] = lines.length === 1
        ? { line: sl, col: sc + text.length }
        : { line: sl + lines.length - 1, col: lines[lines.length - 1].length }
    }
    cursorsRef.current = dedupeCursors(cursors)

    setStatus('●')
    notifyDirty(true)
    onLineCountChangeRef.current?.(lineCountRef.current)
    notifyCursor()
    ensureCursorVisible()
    fetchVisible()
    draw()
    void updateBracketMatch()
  }, [draw, ensureCursorVisible, fetchVisible, notifyCursor, notifyDirty, updateBracketMatch])

  // Replace the identifier prefix immediately left of the cursor with the
  // selected completion's insertText.
  const acceptCompletion = useCallback(async () => {
    const item = completionItemsRef.current[completionIndexRef.current]
    closeCompletions()
    if (!item) return
    const { line, col } = cursorsRef.current[0]
    const data = await ensureLine(line)
    const text = data?.text ?? ''
    let start = col
    while (start > 0 && /[A-Za-z0-9_]/.test(text[start - 1])) start--
    await applyMultiEdit([{ idx: 0, range: [line, start, line, col], text: item.insertText }])
  }, [applyMultiEdit, closeCompletions, ensureLine])

  const applyUndoRedo = useCallback(async (op: 'editor.undo' | 'editor.redo') => {
    if (readOnlyRef.current) return
    closeCompletions()
    const resp = await invoke<{
      applied: boolean; version: number; lineCount: number
      dirtyStart?: number; dirtyEnd?: number
      cursorLine?: number; cursorCol?: number
    }>(op, { bufferId: bufferIdRef.current })
    if (!resp.applied) return
    versionRef.current = resp.version
    lineCountRef.current = resp.lineCount
    lineCacheRef.current.clear()
    const primary = cursorsRef.current[0]
    cursorsRef.current = [{
      line: resp.cursorLine ?? primary.line,
      col: resp.cursorCol ?? primary.col,
    }]
    cursorVisibleRef.current = true
    setStatus('●')
    notifyDirty(true)
    onLineCountChangeRef.current?.(lineCountRef.current)
    notifyCursor()
    ensureCursorVisible()
    fetchVisible()
    draw()
    void updateBracketMatch()
  }, [closeCompletions, draw, ensureCursorVisible, fetchVisible, notifyCursor, notifyDirty, updateBracketMatch])

  const undo = useCallback(() => applyUndoRedo('editor.undo'), [applyUndoRedo])
  const redo = useCallback(() => applyUndoRedo('editor.redo'), [applyUndoRedo])

  const save = useCallback(async () => {
    if (readOnlyRef.current) return
    await invoke('editor.save', { bufferId: bufferIdRef.current })
    setStatus('')
    notifyDirty(false)
  }, [notifyDirty])

  // ── Find / replace ──────────────────────────────────────────────────────────

  // Re-run editor.search with the current query/options and pick the match
  // nearest the primary cursor as "current". Fire-and-forget.
  const runSearch = useCallback(async () => {
    const query = findQueryRef.current
    if (!query) {
      matchesRef.current = []
      currentMatchRef.current = -1
      setMatchCount(0)
      setCurrentMatch(-1)
      draw()
      return
    }
    try {
      const resp = await invoke<{ matches: SearchMatch[] }>('editor.search', {
        bufferId: bufferIdRef.current,
        query,
        regex: findRegexRef.current,
        caseSensitive: findCaseSensitiveRef.current,
        wholeWord: findWholeWordRef.current,
      })
      matchesRef.current = resp.matches
      setMatchCount(resp.matches.length)
      const primary = cursorsRef.current[0]
      let idx = resp.matches.findIndex(m =>
        m.startLine > primary.line || (m.startLine === primary.line && m.startCol >= primary.col))
      if (idx === -1) idx = resp.matches.length > 0 ? 0 : -1
      currentMatchRef.current = idx
      setCurrentMatch(idx)
      draw()
    } catch {
      matchesRef.current = []
      currentMatchRef.current = -1
      setMatchCount(0)
      setCurrentMatch(-1)
      draw()
    }
  }, [draw])

  // Apply a batch of edits (already in document coordinates, any order) —
  // used by replace/replace-all, which build their edits from a search-match
  // snapshot rather than per-cursor like applyMultiEdit.
  const applyRawEdits = useCallback(async (edits: { startLine: number; startCol: number; endLine: number; endCol: number; text: string }[]) => {
    if (edits.length === 0 || readOnlyRef.current) return
    const sorted = [...edits].sort((a, b) => b.startLine - a.startLine || b.startCol - a.startCol)
    const resp = await invoke<{ version: number; lineCount: number }>('editor.edit', {
      bufferId: bufferIdRef.current, edits: sorted,
    })
    versionRef.current = resp.version
    lineCountRef.current = resp.lineCount
    lineCacheRef.current.clear()
    setStatus('●')
    notifyDirty(true)
    onLineCountChangeRef.current?.(lineCountRef.current)
    fetchVisible()
    draw()
    void updateBracketMatch()
  }, [draw, fetchVisible, notifyDirty, updateBracketMatch])

  // Enter/Shift+Enter — select the next/previous match, wrapping around.
  const gotoMatch = useCallback((delta: number) => {
    const matches = matchesRef.current
    const n = matches.length
    if (n === 0) return
    closeCompletions()
    const idx = ((currentMatchRef.current + delta) % n + n) % n
    currentMatchRef.current = idx
    setCurrentMatch(idx)
    const m = matches[idx]
    cursorsRef.current = [{ line: m.endLine, col: m.endCol, anchorLine: m.startLine, anchorCol: m.startCol }]
    cursorVisibleRef.current = true
    notifyCursor()
    ensureCursorVisible()
    fetchVisible()
    draw()
  }, [closeCompletions, draw, ensureCursorVisible, fetchVisible, notifyCursor])

  const replaceCurrent = useCallback(async () => {
    const m = matchesRef.current[currentMatchRef.current]
    if (!m) return
    await applyRawEdits([{ startLine: m.startLine, startCol: m.startCol, endLine: m.endLine, endCol: m.endCol, text: replaceTextRef.current }])
    await runSearch()
  }, [applyRawEdits, runSearch])

  const replaceAllMatches = useCallback(async () => {
    const matches = matchesRef.current
    if (matches.length === 0) return
    const edits = matches.map(m => ({ startLine: m.startLine, startCol: m.startCol, endLine: m.endLine, endCol: m.endCol, text: replaceTextRef.current }))
    await applyRawEdits(edits)
    await runSearch()
  }, [applyRawEdits, runSearch])

  const closeFind = useCallback(() => {
    setFindOpen(false)
    matchesRef.current = []
    currentMatchRef.current = -1
    setMatchCount(0)
    setCurrentMatch(-1)
    draw()
    textareaRef.current?.focus()
  }, [draw])

  const openFind = useCallback((mode: 'find' | 'replace') => {
    closeCompletions()
    setFindMode(mode)
    setFindOpen(true)
    if (findQueryRef.current) void runSearch()
  }, [closeCompletions, runSearch])

  const insertText = useCallback(async (text: string) => {
    const ops = cursorsRef.current.map((c, idx) => {
      const range = rangeOf(c) ?? [c.line, c.col, c.line, c.col] as [number, number, number, number]
      return { idx, range, text }
    })
    await applyMultiEdit(ops)
  }, [applyMultiEdit])

  const deleteBackward = useCallback(async () => {
    closeCompletions()
    const cursors = cursorsRef.current
    const ops: { idx: number; range: [number, number, number, number]; text: string }[] = []
    for (let idx = 0; idx < cursors.length; idx++) {
      const c = cursors[idx]
      const sel = rangeOf(c)
      if (sel) { ops.push({ idx, range: sel, text: '' }); continue }
      if (c.col > 0) {
        ops.push({ idx, range: [c.line, c.col - 1, c.line, c.col], text: '' })
      } else if (c.line > 0) {
        const prev = await ensureLine(c.line - 1)
        const prevLen = prev?.text.length ?? 0
        ops.push({ idx, range: [c.line - 1, prevLen, c.line, 0], text: '' })
      }
    }
    await applyMultiEdit(ops)
  }, [applyMultiEdit, closeCompletions, ensureLine])

  const deleteForward = useCallback(async () => {
    closeCompletions()
    const cursors = cursorsRef.current
    const ops: { idx: number; range: [number, number, number, number]; text: string }[] = []
    for (let idx = 0; idx < cursors.length; idx++) {
      const c = cursors[idx]
      const sel = rangeOf(c)
      if (sel) { ops.push({ idx, range: sel, text: '' }); continue }
      const data = await ensureLine(c.line)
      const len = data?.text.length ?? 0
      if (c.col < len) {
        ops.push({ idx, range: [c.line, c.col, c.line, c.col + 1], text: '' })
      } else if (c.line < lineCountRef.current - 1) {
        ops.push({ idx, range: [c.line, c.col, c.line + 1, 0], text: '' })
      }
    }
    await applyMultiEdit(ops)
  }, [applyMultiEdit, closeCompletions, ensureLine])

  // Enter: copy the current line's leading whitespace onto the new line,
  // adding one indent level if the cursor sits right after an opening
  // bracket. If it also sits right before that bracket's matching closer,
  // split into a blank indented line with the closer pushed to its own line,
  // cursor left on the blank line.
  const handleEnter = useCallback(async () => {
    closeCompletions()
    const cursors = cursorsRef.current
    const ops: Parameters<typeof applyMultiEdit>[0] = []
    for (let idx = 0; idx < cursors.length; idx++) {
      const c = cursors[idx]
      const sel = rangeOf(c)
      if (sel) { ops.push({ idx, range: sel, text: '\n' }); continue }

      const data = await ensureLine(c.line)
      const lineText = data?.text ?? ''
      const indent = lineText.match(/^[ \t]*/)?.[0] ?? ''
      const unit = indent.includes('\t') ? '\t' : '  '
      const prevChar = lineText[c.col - 1]
      const nextChar = lineText[c.col]
      const opensBlock = prevChar === '{' || prevChar === '[' || prevChar === '('
      const closesBlock =
        (prevChar === '{' && nextChar === '}') ||
        (prevChar === '[' && nextChar === ']') ||
        (prevChar === '(' && nextChar === ')')

      const range: [number, number, number, number] = [c.line, c.col, c.line, c.col]
      if (closesBlock) {
        const inner = indent + unit
        ops.push({ idx, range, text: '\n' + inner + '\n' + indent, cursor: { lineOffset: 1, col: inner.length } })
      } else {
        const newIndent = opensBlock ? indent + unit : indent
        ops.push({ idx, range, text: '\n' + newIndent })
      }
    }
    await applyMultiEdit(ops)
  }, [applyMultiEdit, closeCompletions, ensureLine])

  // Handle a single typed character that may participate in an auto-close
  // pair: typing an opener inserts both halves with the cursor between them
  // (wrapping the selection instead, if one is active); typing a closer that
  // already sits immediately to the right of every cursor "types over" it.
  const handleTypedChar = useCallback(async (ch: string) => {
    const cursors = cursorsRef.current

    if (AUTO_CLOSE_CLOSERS.has(ch)) {
      let allTypeOver = true
      for (const c of cursors) {
        if (rangeOf(c)) { allTypeOver = false; break }
        const data = await ensureLine(c.line)
        if (data?.text[c.col] !== ch) { allTypeOver = false; break }
      }
      if (allTypeOver) {
        cursorsRef.current = cursors.map(c => ({ line: c.line, col: c.col + 1 }))
        cursorVisibleRef.current = true
        notifyCursor()
        ensureCursorVisible()
        draw()
        void updateBracketMatch()
        return
      }
    }

    const close = AUTO_CLOSE_PAIRS[ch]
    if (close !== undefined) {
      const ops: Parameters<typeof applyMultiEdit>[0] = []
      for (let idx = 0; idx < cursors.length; idx++) {
        const c = cursors[idx]
        const sel = rangeOf(c)
        if (sel) {
          const [sl, sc, el, ec] = sel
          if (sl === el) {
            const data = await ensureLine(sl)
            const inner = data?.text.slice(sc, ec) ?? ''
            ops.push({ idx, range: sel, text: ch + inner + close })
          } else {
            ops.push({ idx, range: sel, text: ch })
          }
          continue
        }
        ops.push({ idx, range: [c.line, c.col, c.line, c.col], text: ch + close, cursor: { lineOffset: 0, col: c.col + 1 } })
      }
      await applyMultiEdit(ops)
      return
    }

    await insertText(ch)
  }, [applyMultiEdit, draw, ensureCursorVisible, ensureLine, insertText, notifyCursor, updateBracketMatch])

  // ── Cursor navigation ──────────────────────────────────────────────────────

  const moveCursor = useCallback(async (dl: number, dc: number, extend: boolean) => {
    closeCompletions()
    const cursors = cursorsRef.current
    const next: Cursor[] = []
    for (const c of cursors) {
      let anchorLine = c.anchorLine, anchorCol = c.anchorCol
      if (!extend) { anchorLine = undefined; anchorCol = undefined }
      else if (anchorLine === undefined) { anchorLine = c.line; anchorCol = c.col }

      let { line, col } = c
      if (dl !== 0) {
        line = Math.max(0, Math.min(lineCountRef.current - 1, line + dl))
        const data = await ensureLine(line)
        col = Math.min(col, data?.text.length ?? 0)
      }
      if (dc !== 0) {
        col += dc
        if (col < 0) {
          if (line > 0) {
            line--
            const data = await ensureLine(line)
            col = data?.text.length ?? 0
          } else col = 0
        } else {
          const data = await ensureLine(line)
          const len = data?.text.length ?? 0
          if (col > len) {
            if (line < lineCountRef.current - 1) { line++; col = 0 }
            else col = len
          }
        }
      }
      next.push({ line, col, anchorLine, anchorCol })
    }
    cursorsRef.current = dedupeCursors(next)
    cursorVisibleRef.current = true
    notifyCursor()
    ensureCursorVisible()
    fetchVisible()
    draw()
    void updateBracketMatch()
  }, [closeCompletions, draw, ensureCursorVisible, ensureLine, fetchVisible, notifyCursor, updateBracketMatch])

  // Move every cursor to a position derived from its own current position
  // (used for Home/End, which apply per-line).
  const moveCursorsTo = useCallback(async (transform: (c: Cursor) => { line: number; col: number }, extend: boolean) => {
    closeCompletions()
    const cursors = cursorsRef.current
    const next: Cursor[] = []
    for (const c of cursors) {
      let anchorLine = c.anchorLine, anchorCol = c.anchorCol
      if (!extend) { anchorLine = undefined; anchorCol = undefined }
      else if (anchorLine === undefined) { anchorLine = c.line; anchorCol = c.col }

      const pos = transform(c)
      const line = Math.max(0, Math.min(lineCountRef.current - 1, pos.line))
      const data = await ensureLine(line)
      const col = Math.max(0, Math.min(data?.text.length ?? 0, pos.col))
      next.push({ line, col, anchorLine, anchorCol })
    }
    cursorsRef.current = dedupeCursors(next)
    cursorVisibleRef.current = true
    notifyCursor()
    ensureCursorVisible()
    fetchVisible()
    draw()
    void updateBracketMatch()
  }, [closeCompletions, draw, ensureCursorVisible, ensureLine, fetchVisible, notifyCursor, updateBracketMatch])

  // Collapse to a single cursor at (line, col) — used for plain clicks/drags.
  const setCursorTo = useCallback(async (line: number, col: number, extend: boolean) => {
    closeCompletions()
    const primary = cursorsRef.current[0]
    let anchorLine = primary.anchorLine, anchorCol = primary.anchorCol
    if (!extend) { anchorLine = undefined; anchorCol = undefined }
    else if (anchorLine === undefined) { anchorLine = primary.line; anchorCol = primary.col }
    line = Math.max(0, Math.min(lineCountRef.current - 1, line))
    const data = await ensureLine(line)
    col = Math.max(0, Math.min(data?.text.length ?? 0, col))
    cursorsRef.current = [{ line, col, anchorLine, anchorCol }]
    cursorVisibleRef.current = true
    notifyCursor()
    ensureCursorVisible()
    fetchVisible()
    draw()
    void updateBracketMatch()
  }, [closeCompletions, draw, ensureCursorVisible, ensureLine, fetchVisible, notifyCursor, updateBracketMatch])

  // Alt+Click — add a new (unselected) cursor at the clicked position.
  const addCursorAt = useCallback(async (line: number, col: number) => {
    closeCompletions()
    line = Math.max(0, Math.min(lineCountRef.current - 1, line))
    const data = await ensureLine(line)
    col = Math.max(0, Math.min(data?.text.length ?? 0, col))
    cursorsRef.current = dedupeCursors([...cursorsRef.current, { line, col }])
    cursorVisibleRef.current = true
    draw()
  }, [closeCompletions, draw, ensureLine])

  // Ctrl+Alt+Up/Down — add a cursor directly above/below the primary cursor.
  const addCursorVertical = useCallback(async (delta: number) => {
    closeCompletions()
    const primary = cursorsRef.current[0]
    const line = primary.line + delta
    if (line < 0 || line >= lineCountRef.current) return
    const data = await ensureLine(line)
    const col = Math.min(primary.col, data?.text.length ?? 0)
    cursorsRef.current = dedupeCursors([...cursorsRef.current, { line, col }])
    cursorVisibleRef.current = true
    ensureCursorVisible()
    fetchVisible()
    draw()
  }, [closeCompletions, draw, ensureCursorVisible, ensureLine, fetchVisible])

  // ── Init ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    let disposed = false

    async function init() {
      const canvas = canvasRef.current
      if (!canvas) return
      const renderer = new GpuTextRenderer(canvas)
      renderer.setFont(FONT_FAMILY, fontSizeRef.current)
      rendererRef.current = renderer

      const open = await invoke<OpenResp>('editor.open', { path: filePath })
      if (disposed) return
      bufferIdRef.current = open.bufferId
      lineCountRef.current = open.lineCount
      versionRef.current = open.version

      let vs: ViewState = {}
      try {
        const vsResp = await invoke<{ state: ViewState }>('editor.viewstate.get', {
          bufferId: open.bufferId, viewKey: viewKeyRef.current,
        })
        vs = vsResp.state ?? {}
      } catch { /* no saved state */ }
      topLineRef.current = vs.topLine ?? 0
      leftColRef.current = vs.leftCol ?? 0
      cursorsRef.current = [{ line: vs.cursorLine ?? 0, col: vs.cursorCol ?? 0 }]

      dirtyRef.current = open.dirty
      onDirtyChangeRef.current?.(open.dirty)
      onLineCountChangeRef.current?.(open.lineCount)
      onEolChangeRef.current?.(open.eol)
      notifyCursor()

      recomputeViewport()
      setReady(true)
      textareaRef.current?.focus()
      void updateBracketMatch()
    }

    void init()

    const blink = setInterval(() => {
      cursorVisibleRef.current = !cursorVisibleRef.current
      draw()
    }, 530)

    return () => {
      disposed = true
      clearInterval(blink)
      const bufferId = bufferIdRef.current
      if (bufferId) {
        const primary = cursorsRef.current[0]
        void invoke('editor.viewstate.set', {
          bufferId, viewKey: viewKeyRef.current,
          state: {
            topLine: topLineRef.current, leftCol: leftColRef.current,
            cursorLine: primary.line, cursorCol: primary.col,
          },
        }).catch(() => {})
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath])

  // ResizeObserver
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const ro = new ResizeObserver(() => recomputeViewport())
    ro.observe(container)
    return () => ro.disconnect()
  }, [recomputeViewport])

  // Re-derive paint colors whenever the theme-supplied palette changes
  // (e.g. live preview in the theme editor).
  useEffect(() => {
    paintRef.current = buildPaintColors(colors ?? DEFAULT_GPU_COLORS)
    draw()
  }, [colors, draw])

  // External font-size changes (e.g. global zoom-level config) reset any
  // local Ctrl+wheel zoom applied to this instance.
  useEffect(() => {
    if (!ready) return
    fontSizeRef.current = fontSize
    rendererRef.current?.setFont(FONT_FAMILY, fontSize)
    recomputeViewport()
    draw()
  }, [fontSize, ready, recomputeViewport, draw])

  // Jump to the requested line (1-based) whenever it changes.
  useEffect(() => {
    if (!ready || gotoLine === undefined || gotoLine === lastGotoLineRef.current) return
    lastGotoLineRef.current = gotoLine
    void setCursorTo(Math.max(0, gotoLine - 1), 0, false).then(() => {
      textareaRef.current?.focus()
    })
  }, [gotoLine, ready, setCursorTo])

  // Debounced re-search while the find bar is open and the query/options change.
  useEffect(() => {
    if (!findOpen) return
    const t = setTimeout(() => { void runSearch() }, 150)
    return () => clearTimeout(t)
  }, [findOpen, findQuery, findRegex, findCaseSensitive, findWholeWord, runSearch])

  // Toggling the minimap changes the available text columns and the
  // minimap canvas size.
  useEffect(() => {
    if (!ready) return
    recomputeViewport()
    draw()
  }, [minimap, ready, recomputeViewport, draw])

  // ── Input handlers ──────────────────────────────────────────────────────────

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const shift = e.shiftKey

    if (completionOpenRef.current) {
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault()
          setCompletionIndex(i => (i - 1 + completionItemsRef.current.length) % completionItemsRef.current.length)
          return
        case 'ArrowDown':
          e.preventDefault()
          setCompletionIndex(i => (i + 1) % completionItemsRef.current.length)
          return
        case 'Enter':
        case 'Tab':
          e.preventDefault()
          void acceptCompletion()
          return
        case 'Escape':
          e.preventDefault()
          closeCompletions()
          return
      }
    }

    if (e.ctrlKey && e.key === ' ') {
      e.preventDefault()
      void requestCompletions()
      return
    }

    switch (e.key) {
      case 'ArrowUp':
        if (e.ctrlKey && e.altKey) { e.preventDefault(); void addCursorVertical(-1); return }
        e.preventDefault(); void moveCursor(-1, 0, shift); return
      case 'ArrowDown':
        if (e.ctrlKey && e.altKey) { e.preventDefault(); void addCursorVertical(1); return }
        e.preventDefault(); void moveCursor(1, 0, shift); return
      case 'ArrowLeft':  e.preventDefault(); void moveCursor(0, -1, shift); return
      case 'ArrowRight': e.preventDefault(); void moveCursor(0, 1, shift); return
      case 'PageUp':     e.preventDefault(); void moveCursor(-visibleRowsRef.current, 0, shift); return
      case 'PageDown':   e.preventDefault(); void moveCursor(visibleRowsRef.current, 0, shift); return
      case 'Home':       e.preventDefault(); void moveCursorsTo(c => ({ line: c.line, col: 0 }), shift); return
      case 'End':        e.preventDefault(); void moveCursorsTo(c => ({ line: c.line, col: Infinity }), shift); return
      case 'Escape':
        if (findOpenRef.current) { e.preventDefault(); closeFind(); return }
        if (cursorsRef.current.length > 1) {
          e.preventDefault()
          cursorsRef.current = [cursorsRef.current[0]]
          draw()
        }
        return
      case 'Backspace':  e.preventDefault(); void deleteBackward(); return
      case 'Delete':     e.preventDefault(); void deleteForward(); return
      case 'Enter':      e.preventDefault(); void handleEnter(); return
      case 'Tab':        e.preventDefault(); void insertText('  '); return
      case 's':
        if ((e.ctrlKey || e.metaKey) && !readOnlyRef.current) {
          e.preventDefault()
          void save()
        }
        return
      case 'z':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault()
          if (shift) void redo()
          else void undo()
        }
        return
      case 'y':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault()
          void redo()
        }
        return
      case 'f':
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); openFind('find') }
        return
      case 'h':
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); openFind('replace') }
        return
      default:
        if (!e.ctrlKey && !e.metaKey && !e.altKey && (AUTO_CLOSE_PAIRS[e.key] !== undefined || AUTO_CLOSE_CLOSERS.has(e.key))) {
          e.preventDefault()
          void handleTypedChar(e.key)
        }
        return
    }
  }, [acceptCompletion, addCursorVertical, closeCompletions, closeFind, deleteBackward, deleteForward, draw, handleEnter, handleTypedChar, insertText, moveCursor, moveCursorsTo, openFind, redo, requestCompletions, save, undo])

  const onInput = useCallback((e: React.FormEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget
    const text = ta.value
    ta.value = ''
    if (!text) return
    void insertText(text).then(() => {
      if (text.length === 1 && /[A-Za-z0-9_]/.test(text)) scheduleCompletions()
      else closeCompletions()
    })
  }, [closeCompletions, insertText, scheduleCompletions])

  const pixelToPos = useCallback((clientX: number, clientY: number) => {
    const renderer = rendererRef.current
    const canvas = canvasRef.current
    if (!renderer || !canvas) return null
    const rect = canvas.getBoundingClientRect()
    const gutterWidth = (Math.max(3, String(Math.max(1, lineCountRef.current)).length) + 1) * renderer.cellWidth
    const x = clientX - rect.left - gutterWidth
    const y = clientY - rect.top
    const line = topLineRef.current + Math.floor(y / renderer.cellHeight)
    const col = leftColRef.current + Math.round(x / renderer.cellWidth)
    return { line: Math.max(0, line), col: Math.max(0, col) }
  }, [])

  const draggingRef = useRef(false)

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const pos = pixelToPos(e.clientX, e.clientY)
    if (!pos) return
    textareaRef.current?.focus()
    if (e.altKey) {
      void addCursorAt(pos.line, pos.col)
      return
    }
    draggingRef.current = true
    void setCursorTo(pos.line, pos.col, e.shiftKey)
  }, [addCursorAt, pixelToPos, setCursorTo])

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!draggingRef.current) return
    const pos = pixelToPos(e.clientX, e.clientY)
    if (!pos) return
    void setCursorTo(pos.line, pos.col, true)
  }, [pixelToPos, setCursorTo])

  const onMouseUp = useCallback(() => { draggingRef.current = false }, [])

  // ── Minimap interaction ─────────────────────────────────────────────────────

  const minimapDraggingRef = useRef(false)

  // Center the viewport on the line under the given client Y coordinate.
  const scrollToMinimapY = useCallback((clientY: number) => {
    const mmCanvas = minimapCanvasRef.current
    if (!mmCanvas) return
    const rect = mmCanvas.getBoundingClientRect()
    const line = minimapLineAt(clientY - rect.top, minimapGeomRef.current)
    topLineRef.current = Math.max(0, line - Math.floor(visibleRowsRef.current / 2))
    clampScroll()
    fetchVisible()
    draw()
  }, [clampScroll, draw, fetchVisible])

  const onMinimapMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    minimapDraggingRef.current = true
    scrollToMinimapY(e.clientY)
  }, [scrollToMinimapY])

  const onMinimapMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!minimapDraggingRef.current) return
    scrollToMinimapY(e.clientY)
  }, [scrollToMinimapY])

  const onMinimapMouseUp = useCallback(() => { minimapDraggingRef.current = false }, [])

  // Native (non-passive) wheel listener: Ctrl+wheel zooms the font and must
  // call preventDefault to stop the browser's page-zoom; plain wheel scrolls
  // the viewport. React's onWheel can't reliably preventDefault wheel events.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const handler = (e: WheelEvent) => {
      const renderer = rendererRef.current
      if (!renderer) return
      if (e.ctrlKey) {
        e.preventDefault()
        const next = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, fontSizeRef.current + (e.deltaY < 0 ? 1 : -1)))
        if (next !== fontSizeRef.current) {
          fontSizeRef.current = next
          renderer.setFont(FONT_FAMILY, next)
          recomputeViewport()
          draw()
        }
        return
      }
      const dLines = Math.round(e.deltaY / renderer.cellHeight) || (e.deltaY > 0 ? 1 : e.deltaY < 0 ? -1 : 0)
      const dCols = Math.round(e.deltaX / renderer.cellWidth)
      if (dLines !== 0) topLineRef.current += dLines
      if (dCols !== 0) leftColRef.current += dCols
      clampScroll()
      fetchVisible()
      draw()
    }
    container.addEventListener('wheel', handler, { passive: false })
    return () => container.removeEventListener('wheel', handler)
  }, [clampScroll, draw, fetchVisible, recomputeViewport])

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
    save,
    undo: () => { void undo() },
    redo: () => { void redo() },
  }), [save, undo, redo])

  return (
    <div className="flex-1 flex flex-col bg-[var(--app-bg)] overflow-hidden">
      {showHeader && (
        <div className="px-[14px] text-[11px] text-[var(--info-bar-color)] bg-[var(--info-bar-bg)] border-b border-[var(--border-color)] font-mono whitespace-nowrap overflow-hidden text-ellipsis shrink-0 h-[26px] leading-[26px] flex items-center justify-between">
          <span>{filePath}</span>
          <span>{status}</span>
        </div>
      )}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden"
      >
        <canvas
          ref={canvasRef}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          style={{ display: 'block', cursor: 'text' }}
        />
        {minimap && (
          <canvas
            ref={minimapCanvasRef}
            onMouseDown={onMinimapMouseDown}
            onMouseMove={onMinimapMouseMove}
            onMouseUp={onMinimapMouseUp}
            onMouseLeave={onMinimapMouseUp}
            style={{ position: 'absolute', top: 0, right: 0, width: `${MINIMAP_WIDTH}px`, height: '100%', cursor: 'pointer' }}
          />
        )}
        <textarea
          ref={textareaRef}
          onKeyDown={onKeyDown}
          onInput={onInput}
          readOnly={readOnly}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          style={{
            position: 'absolute', top: 0, left: 0, width: '1px', height: '1px',
            opacity: 0, padding: 0, border: 'none', resize: 'none', overflow: 'hidden',
          }}
        />
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center text-[12px] text-[var(--info-bar-color)]">
            Loading…
          </div>
        )}
        {findOpen && (
          <FindReplaceBar
            mode={findMode}
            query={findQuery}
            replacement={replaceText}
            matchCount={matchCount}
            currentIndex={currentMatch}
            regex={findRegex}
            caseSensitive={findCaseSensitive}
            wholeWord={findWholeWord}
            onQueryChange={setFindQuery}
            onReplacementChange={setReplaceText}
            onToggleRegex={() => setFindRegex(v => !v)}
            onToggleCaseSensitive={() => setFindCaseSensitive(v => !v)}
            onToggleWholeWord={() => setFindWholeWord(v => !v)}
            onToggleMode={() => setFindMode(m => m === 'find' ? 'replace' : 'find')}
            onNext={() => gotoMatch(1)}
            onPrev={() => gotoMatch(-1)}
            onReplace={() => void replaceCurrent()}
            onReplaceAll={() => void replaceAllMatches()}
            onClose={closeFind}
          />
        )}
        {completionOpen && (
          <CompletionsPopup
            items={completionItems}
            index={completionIndex}
            x={completionPos.x}
            y={completionPos.y}
            onSelect={setCompletionIndex}
            onAccept={i => { completionIndexRef.current = i; void acceptCompletion() }}
          />
        )}
      </div>
    </div>
  )
})

export default GpuEditor
