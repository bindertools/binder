import React, { useRef, useEffect, useCallback, useState } from 'react'
import { invoke } from '../lib/ipc'
import { GpuTextRenderer, hexToRgba, type RGBA } from '../lib/gpuTextRenderer'
import type { GpuEditorColors } from '../themes'

interface LineData { text: string; spans: [number, number, number][] }

interface OpenResp {
  bufferId: number
  lineCount: number
  language: string
  version: number
  styles: string[]
  existing: boolean
}

interface ViewState {
  topLine?: number
  leftCol?: number
  cursorLine?: number
  cursorCol?: number
}

interface Props {
  filePath: string
  fontSize?: number
  colors?: GpuEditorColors
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
}

interface PaintColors {
  bg: RGBA
  gutter: RGBA
  currentLine: RGBA
  cursor: RGBA
  selection: RGBA
  styles: RGBA[]
}

function buildPaintColors(c: GpuEditorColors): PaintColors {
  return {
    bg: hexToRgba(c.bg),
    gutter: hexToRgba(c.gutter),
    currentLine: hexToRgba(c.currentLine),
    cursor: hexToRgba(c.cursor),
    selection: hexToRgba(c.selection, 0.55),
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

const OVERSCAN = 10

export default function GpuEditor({ filePath, fontSize = 13, colors }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const rendererRef = useRef<GpuTextRenderer | null>(null)

  const bufferIdRef = useRef<number>(0)
  const lineCountRef = useRef<number>(0)
  const lineCacheRef = useRef<Map<number, LineData>>(new Map())
  const versionRef = useRef<number>(0)

  const topLineRef = useRef<number>(0)
  const leftColRef = useRef<number>(0)
  const cursorsRef = useRef<Cursor[]>([{ line: 0, col: 0 }])
  const visibleRowsRef = useRef<number>(1)
  const visibleColsRef = useRef<number>(1)
  const cursorVisibleRef = useRef<boolean>(true)
  const dprRef = useRef<number>(1)

  const [ready, setReady] = useState(false)
  const [status, setStatus] = useState('')

  const paintRef = useRef<PaintColors>(buildPaintColors(colors ?? DEFAULT_GPU_COLORS))

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
    visibleRowsRef.current = Math.max(1, Math.ceil(h / renderer.cellHeight))
    visibleColsRef.current = Math.max(1, Math.floor((w - gutterWidth) / renderer.cellWidth))
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

  // ── Editing ─────────────────────────────────────────────────────────────────

  // Apply one edit per cursor (some cursors may be skipped — e.g. a no-op
  // backspace at the start of the document). `ops[].idx` indexes into
  // `cursorsRef.current`; edits are sent to the backend in reverse document
  // order so earlier entries' coordinates aren't invalidated by later ones,
  // and each cursor's new position is then computed purely from its own
  // edit (safe because reverse order means no edit shifts a not-yet-applied
  // cursor's coordinates).
  const applyMultiEdit = useCallback(async (ops: { idx: number; range: [number, number, number, number]; text: string }[]) => {
    if (ops.length === 0) return
    const sorted = [...ops].sort((a, b) => b.range[0] - a.range[0] || b.range[1] - a.range[1])
    const edits = sorted.map(({ range: [sl, sc, el, ec], text }) => ({ startLine: sl, startCol: sc, endLine: el, endCol: ec, text }))
    const resp = await invoke<{ version: number; lineCount: number; dirtyStart: number; dirtyEnd: number }>('editor.edit', {
      bufferId: bufferIdRef.current, edits,
    })
    versionRef.current = resp.version
    lineCountRef.current = resp.lineCount
    lineCacheRef.current.clear()

    const cursors = cursorsRef.current.slice()
    for (const { idx, range: [sl, sc], text } of ops) {
      const lines = text.split('\n')
      cursors[idx] = lines.length === 1
        ? { line: sl, col: sc + text.length }
        : { line: sl + lines.length - 1, col: lines[lines.length - 1].length }
    }
    cursorsRef.current = dedupeCursors(cursors)

    setStatus('●')
    ensureCursorVisible()
    fetchVisible()
    draw()
  }, [draw, ensureCursorVisible, fetchVisible])

  const applyUndoRedo = useCallback(async (op: 'editor.undo' | 'editor.redo') => {
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
    ensureCursorVisible()
    fetchVisible()
    draw()
  }, [draw, ensureCursorVisible, fetchVisible])

  const undo = useCallback(() => applyUndoRedo('editor.undo'), [applyUndoRedo])
  const redo = useCallback(() => applyUndoRedo('editor.redo'), [applyUndoRedo])

  const insertText = useCallback(async (text: string) => {
    const ops = cursorsRef.current.map((c, idx) => {
      const range = rangeOf(c) ?? [c.line, c.col, c.line, c.col] as [number, number, number, number]
      return { idx, range, text }
    })
    await applyMultiEdit(ops)
  }, [applyMultiEdit])

  const deleteBackward = useCallback(async () => {
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
  }, [applyMultiEdit, ensureLine])

  const deleteForward = useCallback(async () => {
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
  }, [applyMultiEdit, ensureLine])

  // ── Cursor navigation ──────────────────────────────────────────────────────

  const moveCursor = useCallback(async (dl: number, dc: number, extend: boolean) => {
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
    ensureCursorVisible()
    fetchVisible()
    draw()
  }, [draw, ensureCursorVisible, ensureLine, fetchVisible])

  // Move every cursor to a position derived from its own current position
  // (used for Home/End, which apply per-line).
  const moveCursorsTo = useCallback(async (transform: (c: Cursor) => { line: number; col: number }, extend: boolean) => {
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
    ensureCursorVisible()
    fetchVisible()
    draw()
  }, [draw, ensureCursorVisible, ensureLine, fetchVisible])

  // Collapse to a single cursor at (line, col) — used for plain clicks/drags.
  const setCursorTo = useCallback(async (line: number, col: number, extend: boolean) => {
    const primary = cursorsRef.current[0]
    let anchorLine = primary.anchorLine, anchorCol = primary.anchorCol
    if (!extend) { anchorLine = undefined; anchorCol = undefined }
    else if (anchorLine === undefined) { anchorLine = primary.line; anchorCol = primary.col }
    line = Math.max(0, Math.min(lineCountRef.current - 1, line))
    const data = await ensureLine(line)
    col = Math.max(0, Math.min(data?.text.length ?? 0, col))
    cursorsRef.current = [{ line, col, anchorLine, anchorCol }]
    cursorVisibleRef.current = true
    ensureCursorVisible()
    fetchVisible()
    draw()
  }, [draw, ensureCursorVisible, ensureLine, fetchVisible])

  // Alt+Click — add a new (unselected) cursor at the clicked position.
  const addCursorAt = useCallback(async (line: number, col: number) => {
    line = Math.max(0, Math.min(lineCountRef.current - 1, line))
    const data = await ensureLine(line)
    col = Math.max(0, Math.min(data?.text.length ?? 0, col))
    cursorsRef.current = dedupeCursors([...cursorsRef.current, { line, col }])
    cursorVisibleRef.current = true
    draw()
  }, [draw, ensureLine])

  // Ctrl+Alt+Up/Down — add a cursor directly above/below the primary cursor.
  const addCursorVertical = useCallback(async (delta: number) => {
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
  }, [draw, ensureCursorVisible, ensureLine, fetchVisible])

  // ── Init ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    let disposed = false

    async function init() {
      const canvas = canvasRef.current
      if (!canvas) return
      const renderer = new GpuTextRenderer(canvas)
      renderer.setFont("'Cascadia Code', 'Fira Code', 'JetBrains Mono', Menlo, Monaco, monospace", fontSize)
      rendererRef.current = renderer

      const open = await invoke<OpenResp>('editor.open', { path: filePath })
      if (disposed) return
      bufferIdRef.current = open.bufferId
      lineCountRef.current = open.lineCount
      versionRef.current = open.version

      let vs: ViewState = {}
      try {
        const vsResp = await invoke<{ state: ViewState }>('editor.viewstate.get', { bufferId: open.bufferId })
        vs = vsResp.state ?? {}
      } catch { /* no saved state */ }
      topLineRef.current = vs.topLine ?? 0
      leftColRef.current = vs.leftCol ?? 0
      cursorsRef.current = [{ line: vs.cursorLine ?? 0, col: vs.cursorCol ?? 0 }]

      recomputeViewport()
      setReady(true)
      textareaRef.current?.focus()
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
          bufferId,
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

  // ── Input handlers ──────────────────────────────────────────────────────────

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const shift = e.shiftKey
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
        if (cursorsRef.current.length > 1) {
          e.preventDefault()
          cursorsRef.current = [cursorsRef.current[0]]
          draw()
        }
        return
      case 'Backspace':  e.preventDefault(); void deleteBackward(); return
      case 'Delete':     e.preventDefault(); void deleteForward(); return
      case 'Tab':        e.preventDefault(); void insertText('  '); return
      case 's':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault()
          void invoke('editor.save', { bufferId: bufferIdRef.current }).then(() => setStatus(''))
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
      default: return
    }
  }, [addCursorVertical, deleteBackward, deleteForward, draw, insertText, moveCursor, moveCursorsTo, redo, undo])

  const onInput = useCallback((e: React.FormEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget
    const text = ta.value
    ta.value = ''
    if (text) void insertText(text)
  }, [insertText])

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

  const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const renderer = rendererRef.current
    if (!renderer) return
    const dLines = Math.round(e.deltaY / renderer.cellHeight) || (e.deltaY > 0 ? 1 : e.deltaY < 0 ? -1 : 0)
    const dCols = Math.round(e.deltaX / renderer.cellWidth)
    if (dLines !== 0) topLineRef.current += dLines
    if (dCols !== 0) leftColRef.current += dCols
    clampScroll()
    fetchVisible()
    draw()
  }, [clampScroll, draw, fetchVisible])

  return (
    <div className="flex-1 flex flex-col bg-[var(--app-bg)] overflow-hidden">
      <div className="px-[14px] text-[11px] text-[var(--info-bar-color)] bg-[var(--info-bar-bg)] border-b border-[var(--border-color)] font-mono whitespace-nowrap overflow-hidden text-ellipsis shrink-0 h-[26px] leading-[26px] flex items-center justify-between">
        <span>{filePath}</span>
        <span>{status}</span>
      </div>
      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden"
        onWheel={onWheel}
      >
        <canvas
          ref={canvasRef}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          style={{ display: 'block', cursor: 'text' }}
        />
        <textarea
          ref={textareaRef}
          onKeyDown={onKeyDown}
          onInput={onInput}
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
      </div>
    </div>
  )
}
