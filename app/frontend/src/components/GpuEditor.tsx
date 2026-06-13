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
  const cursorRef = useRef<{ line: number; col: number }>({ line: 0, col: 0 })
  const selAnchorRef = useRef<{ line: number; col: number } | null>(null)
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
    const { line: curLine, col: curCol } = cursorRef.current
    const sel = selectionRange()

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

      // Selection background
      if (sel) {
        const [sLine, sCol, eLine, eCol] = sel
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

    // Cursor
    if (cursorVisibleRef.current && curLine >= top && curLine < top + rows) {
      const x = gutterWidth + (curCol - left) * cw
      const y = (curLine - top) * ch
      if (curCol - left >= 0 && curCol - left <= cols) {
        renderer.drawRect(x, y, 2, ch, paintRef.current.cursor)
      }
    }

    renderer.endFrame()
  }, [])

  function selectionRange(): [number, number, number, number] | null {
    const anchor = selAnchorRef.current
    if (!anchor) return null
    const cur = cursorRef.current
    if (anchor.line === cur.line && anchor.col === cur.col) return null
    if (anchor.line < cur.line || (anchor.line === cur.line && anchor.col < cur.col)) {
      return [anchor.line, anchor.col, cur.line, cur.col]
    }
    return [cur.line, cur.col, anchor.line, anchor.col]
  }

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
    const { line, col } = cursorRef.current
    const rows = visibleRowsRef.current
    const cols = visibleColsRef.current
    if (line < topLineRef.current) topLineRef.current = line
    else if (line >= topLineRef.current + rows) topLineRef.current = line - rows + 1
    if (col < leftColRef.current) leftColRef.current = col
    else if (col >= leftColRef.current + cols) leftColRef.current = col - cols + 1
    clampScroll()
  }, [clampScroll])

  // ── Editing ─────────────────────────────────────────────────────────────────

  const applyEdit = useCallback(async (sl: number, sc: number, el: number, ec: number, text: string) => {
    const resp = await invoke<{ version: number; lineCount: number; dirtyStart: number; dirtyEnd: number }>('editor.edit', {
      bufferId: bufferIdRef.current,
      edits: [{ startLine: sl, startCol: sc, endLine: el, endCol: ec, text }],
    })
    versionRef.current = resp.version
    lineCountRef.current = resp.lineCount
    lineCacheRef.current.clear()
    setStatus('●')
    fetchVisible()
    draw()
  }, [draw, fetchVisible])

  const insertText = useCallback(async (text: string) => {
    const sel = selectionRange()
    let sl: number, sc: number, el: number, ec: number
    if (sel) {
      [sl, sc, el, ec] = sel
      selAnchorRef.current = null
    } else {
      sl = el = cursorRef.current.line
      sc = ec = cursorRef.current.col
    }
    const lines = text.split('\n')
    if (lines.length === 1) {
      cursorRef.current = { line: sl, col: sc + text.length }
    } else {
      cursorRef.current = { line: sl + lines.length - 1, col: lines[lines.length - 1].length }
    }
    ensureCursorVisible()
    await applyEdit(sl, sc, el, ec, text)
  }, [applyEdit, ensureCursorVisible])

  const deleteBackward = useCallback(async () => {
    const sel = selectionRange()
    if (sel) {
      const [sl, sc, el, ec] = sel
      selAnchorRef.current = null
      cursorRef.current = { line: sl, col: sc }
      ensureCursorVisible()
      await applyEdit(sl, sc, el, ec, '')
      return
    }
    const { line, col } = cursorRef.current
    if (col > 0) {
      cursorRef.current = { line, col: col - 1 }
      ensureCursorVisible()
      await applyEdit(line, col - 1, line, col, '')
    } else if (line > 0) {
      const prev = await ensureLine(line - 1)
      const prevLen = prev?.text.length ?? 0
      cursorRef.current = { line: line - 1, col: prevLen }
      ensureCursorVisible()
      await applyEdit(line - 1, prevLen, line, 0, '')
    }
  }, [applyEdit, ensureCursorVisible, ensureLine])

  const deleteForward = useCallback(async () => {
    const sel = selectionRange()
    if (sel) {
      const [sl, sc, el, ec] = sel
      selAnchorRef.current = null
      cursorRef.current = { line: sl, col: sc }
      ensureCursorVisible()
      await applyEdit(sl, sc, el, ec, '')
      return
    }
    const { line, col } = cursorRef.current
    const data = await ensureLine(line)
    const len = data?.text.length ?? 0
    if (col < len) {
      await applyEdit(line, col, line, col + 1, '')
    } else if (line < lineCountRef.current - 1) {
      await applyEdit(line, col, line + 1, 0, '')
    }
  }, [applyEdit, ensureCursorVisible, ensureLine])

  // ── Cursor navigation ──────────────────────────────────────────────────────

  const moveCursor = useCallback(async (dl: number, dc: number, extend: boolean) => {
    if (!extend) selAnchorRef.current = null
    else if (!selAnchorRef.current) selAnchorRef.current = { ...cursorRef.current }

    let { line, col } = cursorRef.current
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
    cursorRef.current = { line, col }
    cursorVisibleRef.current = true
    ensureCursorVisible()
    fetchVisible()
    draw()
  }, [draw, ensureCursorVisible, ensureLine, fetchVisible])

  const setCursorTo = useCallback(async (line: number, col: number, extend: boolean) => {
    if (!extend) selAnchorRef.current = null
    else if (!selAnchorRef.current) selAnchorRef.current = { ...cursorRef.current }
    line = Math.max(0, Math.min(lineCountRef.current - 1, line))
    const data = await ensureLine(line)
    col = Math.max(0, Math.min(data?.text.length ?? 0, col))
    cursorRef.current = { line, col }
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
      cursorRef.current = { line: vs.cursorLine ?? 0, col: vs.cursorCol ?? 0 }

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
        void invoke('editor.viewstate.set', {
          bufferId,
          state: {
            topLine: topLineRef.current, leftCol: leftColRef.current,
            cursorLine: cursorRef.current.line, cursorCol: cursorRef.current.col,
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
      case 'ArrowUp':    e.preventDefault(); void moveCursor(-1, 0, shift); return
      case 'ArrowDown':  e.preventDefault(); void moveCursor(1, 0, shift); return
      case 'ArrowLeft':  e.preventDefault(); void moveCursor(0, -1, shift); return
      case 'ArrowRight': e.preventDefault(); void moveCursor(0, 1, shift); return
      case 'PageUp':     e.preventDefault(); void moveCursor(-visibleRowsRef.current, 0, shift); return
      case 'PageDown':   e.preventDefault(); void moveCursor(visibleRowsRef.current, 0, shift); return
      case 'Home':       e.preventDefault(); void setCursorTo(cursorRef.current.line, 0, shift); return
      case 'End':        e.preventDefault(); void setCursorTo(cursorRef.current.line, Infinity, shift); return
      case 'Backspace':  e.preventDefault(); void deleteBackward(); return
      case 'Delete':     e.preventDefault(); void deleteForward(); return
      case 'Tab':        e.preventDefault(); void insertText('  '); return
      case 's':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault()
          void invoke('editor.save', { bufferId: bufferIdRef.current }).then(() => setStatus(''))
        }
        return
      default: return
    }
  }, [deleteBackward, deleteForward, insertText, moveCursor, setCursorTo])

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
    draggingRef.current = true
    void setCursorTo(pos.line, pos.col, e.shiftKey)
  }, [pixelToPos, setCursorTo])

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
