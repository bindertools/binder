import React, { useRef, useEffect, useCallback, useState, forwardRef, useImperativeHandle } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { invoke } from '../lib/ipc'
import { git, parseChangedLines } from '../lib/git'
import { GpuTextRenderer, hexToRgba, type RGBA } from '../lib/gpuTextRenderer'
import { computeMinimapGeometry, drawMinimap, minimapLineAt, MINIMAP_WIDTH, type MinimapGeometry } from '../lib/minimapRenderer'
import type { GpuEditorColors } from '../themes'
import FindReplaceBar from './FindReplaceBar'
import CompletionsPopup, { type CompletionItem } from './CompletionsPopup'
import './GpuEditor.css'

interface LineData { text: string; spans: [number, number, number][] }

// One visible row's gutter decorations: the pin/mark dot and, for lines that
// open an indented block, the fold chevron.
interface GutterOverlayRow {
  ln: number
  y: number
  foldable: boolean
  folded: boolean
  pinned: boolean
  current: boolean
}

interface GutterOverlayState {
  gutterWidth: number
  cw: number
  ch: number
  rows: GutterOverlayRow[]
}

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
  pinnedLines?: number[]
}

export interface GpuEditorHandle {
  focus: () => void
  save: () => Promise<void>
  undo: () => void
  redo: () => void
  selectAll: () => void
  openFind: (mode: 'find' | 'replace') => void
  goToLine: (line: number) => void
  expandSmartSelect: () => void
  shrinkSmartSelect: () => void
  moveLineUp: () => void
  moveLineDown: () => void
  copyLineUp: () => void
  copyLineDown: () => void
}

interface Props {
  filePath: string
  fontSize?: number
  colors?: GpuEditorColors
  readOnly?: boolean
  minimap?: boolean
  indentGuides?: boolean
  wordWrap?: boolean
  gotoLine?: number
  // Per-pane view-state key (cursor/scroll position), so two panes showing
  // the same buffer keep independent cursor/scroll. Omit for single-pane
  // consumers (backend defaults to a shared "" key).
  viewKey?: string
  // Show the internal filename/status header bar. Consumers with their own
  // tab bar + status bar (FullscreenIDE) set this to false.
  showHeader?: boolean
  // Diagnostics for this file (lint/type-check errors and warnings), drawn
  // as gutter bars. `line` is 1-based to match ProbItem/gotoLine convention.
  diagnostics?: { line: number; sev: number; msg: string; code: string }[]
  gitGutter?: boolean
  gotoToken?: number
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
  gutterActive: '#cccccc',
  currentLine: '#1a1a1a',
  cursor: '#cccccc',
  selection: '#264f78',
  findMatch: '#623315',
  findMatchActive: '#a8741a',
  gitModified: '#3794ff',
  errorLine: '#f14c4c',
  warningLine: '#cca700',
}

interface PaintColors {
  bg: RGBA
  gutter: RGBA
  gutterActive: RGBA
  currentLine: RGBA
  cursor: RGBA
  selection: RGBA
  indentGuide: RGBA
  findMatch: RGBA
  findMatchActive: RGBA
  gitModified: RGBA
  errorLine: RGBA
  warningLine: RGBA
  styles: RGBA[]
}

function buildPaintColors(c: GpuEditorColors): PaintColors {
  return {
    bg: hexToRgba(c.bg),
    gutter: hexToRgba(c.gutter),
    gutterActive: hexToRgba(c.gutterActive),
    currentLine: hexToRgba(c.currentLine),
    cursor: hexToRgba(c.cursor),
    selection: hexToRgba(c.selection, 0.55),
    indentGuide: hexToRgba(c.gutter, 0.18),
    findMatch: hexToRgba(c.findMatch, 0.55),
    findMatchActive: hexToRgba(c.findMatchActive, 0.75),
    gitModified: hexToRgba(c.gitModified),
    errorLine: hexToRgba(c.errorLine),
    warningLine: hexToRgba(c.warningLine),
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

// Indentation width (in columns) of a line's leading whitespace — tabs
// advance to the next INDENT_SIZE stop, matching the indent-guide columns.
function lineIndent(text: string): number {
  let cols = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === ' ') cols++
    else if (c === '\t') cols += INDENT_SIZE - (cols % INDENT_SIZE)
    else break
  }
  return cols
}

// How far indent-guide scanning will look past a blank line for the nearest
// non-blank neighbor — bounds the cost of files with very long blank runs.
const MAX_BLANK_SCAN = 500

// Indentation to draw guides at for `ln`. Non-blank lines use their own
// leading whitespace; blank lines borrow the deeper of their surrounding
// non-blank neighbors' indentation so guides run continuously through gaps
// instead of disappearing on empty lines.
function guideIndent(ln: number, lineCount: number, cache: Map<number, LineData>): number {
  const data = cache.get(ln)
  if (!data) return 0
  if (data.text.trim().length > 0) return lineIndent(data.text)

  let prev = 0
  for (let i = ln - 1, scanned = 0; i >= 0 && scanned < MAX_BLANK_SCAN; i--, scanned++) {
    const d = cache.get(i)
    if (!d) break
    if (d.text.trim().length > 0) { prev = lineIndent(d.text); break }
  }
  let next = 0
  for (let i = ln + 1, scanned = 0; i < lineCount && scanned < MAX_BLANK_SCAN; i++, scanned++) {
    const d = cache.get(i)
    if (!d) break
    if (d.text.trim().length > 0) { next = lineIndent(d.text); break }
  }
  return Math.max(prev, next)
}

// Cap on how many lines computeFoldEnd will scan ahead — bounds the cost of
// large pretty-printed files (e.g. deeply-nested JSON) where a top-level
// block could otherwise span the entire cached range.
const MAX_FOLD_SCAN = 2000

// The last line (inclusive, 0-based) of the indented block that `ln` opens,
// or null if `ln` isn't a fold anchor. Purely indentation-based, so it
// degrades gracefully when later lines aren't cached yet (stops early).
function computeFoldEnd(ln: number, lineCount: number, cache: Map<number, LineData>): number | null {
  const data = cache.get(ln)
  if (!data || data.text.trim().length === 0) return null
  const baseIndent = lineIndent(data.text)
  let end = -1
  const limit = Math.min(lineCount, ln + 1 + MAX_FOLD_SCAN)
  for (let i = ln + 1; i < limit; i++) {
    const d = cache.get(i)
    if (!d) break
    if (d.text.trim().length === 0) continue
    if (lineIndent(d.text) <= baseIndent) break
    end = i
  }
  return end > ln ? end : null
}

// True if `ln` is hidden inside a collapsed fold (anchor lines remain visible).
function isLineHidden(ln: number, folds: Map<number, number>): boolean {
  for (const [anchor, end] of folds) {
    if (ln > anchor && ln <= end) return true
  }
  return false
}

// The nearest visible line at or after `ln`, skipping collapsed ranges.
function nextVisibleLine(ln: number, folds: Map<number, number>): number {
  let result = ln
  for (;;) {
    let maxEnd = -1
    for (const [anchor, end] of folds) {
      if (result > anchor && result <= end) maxEnd = Math.max(maxEnd, end)
    }
    if (maxEnd < 0) return result
    result = maxEnd + 1
  }
}

// Reveal `ln` by removing any (possibly nested) folds that hide it.
function unfoldContaining(ln: number, folds: Map<number, number>) {
  let changed = true
  while (changed) {
    changed = false
    for (const [anchor, end] of folds) {
      if (ln > anchor && ln <= end) { folds.delete(anchor); changed = true; break }
    }
  }
}

// Adjust line numbers in a gutter decoration set (pins, git-changed lines)
// after an edit changes the line count: lines before the edited range are
// untouched, lines after shift by the change in line count, and entries
// inside the edited range are dropped (their content changed, so callers
// that want to re-mark that range should add it back afterwards).
function shiftLineSet(pins: Set<number>, prevLineCount: number, newLineCount: number, dirtyStart: number, dirtyEnd: number) {
  if (newLineCount === prevLineCount) return
  const delta = newLineCount - prevLineCount
  const next = new Set<number>()
  for (const p of pins) {
    if (p < dirtyStart) next.add(p)
    else if (p > dirtyEnd) next.add(p + delta)
  }
  pins.clear()
  for (const p of next) pins.add(p)
}

// Mark lines [start, end] (inclusive, clamped to the document) as changed in
// the git gutter. Called on every edit so the blue indicator bar appears as
// soon as the user types, rather than only after a save triggers a real
// `git diff` via fetchGitGutter().
function markLinesChanged(changed: Set<number>, start: number, end: number, lineCount: number) {
  const from = Math.max(0, start)
  const to = Math.min(lineCount - 1, Math.max(end, start))
  for (let i = from; i <= to; i++) changed.add(i)
}

// Actual (0-based) line numbers to render, up to `count` rows starting at
// `top`, skipping lines hidden inside collapsed folds.
function computeVisibleLines(top: number, count: number, lineCount: number, folds: Map<number, number>): number[] {
  const result: number[] = []
  let ln = top
  while (result.length < count && ln < lineCount) {
    if (!isLineHidden(ln, folds)) result.push(ln)
    ln++
  }
  return result
}

// Start column of each visual row when `text` is soft-wrapped at `cols`.
function computeWraps(text: string, cols: number): number[] {
  if (cols <= 0) return [0]
  const starts: number[] = [0]
  for (let pos = cols; pos < text.length; pos += cols) starts.push(pos)
  return starts
}

interface DisplayRow { logicalLine: number; startCol: number; isFirst: boolean }

// Build visual display rows for word-wrap mode. Each logical line may produce
// multiple rows; folded anchor lines always emit exactly 1 row.
function computeDisplayRows(
  top: number, maxRows: number, lineCount: number,
  folds: Map<number, number>, cache: Map<number, LineData>, wrapCols: number,
): DisplayRow[] {
  const result: DisplayRow[] = []
  let ln = top
  while (result.length < maxRows && ln < lineCount) {
    if (!isLineHidden(ln, folds)) {
      if (folds.has(ln)) {
        result.push({ logicalLine: ln, startCol: 0, isFirst: true })
      } else {
        const text = cache.get(ln)?.text ?? ''
        const starts = computeWraps(text, wrapCols)
        for (let wi = 0; wi < starts.length && result.length < maxRows; wi++) {
          result.push({ logicalLine: ln, startCol: starts[wi], isFirst: wi === 0 })
        }
      }
    }
    ln++
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

// Lines scrolled per "notch" of a standard mouse wheel (deltaY of ~100px).
const LINES_PER_WHEEL_NOTCH = 3

// Default/maximum height of the completions popup — also used to decide
// whether it should open above or below the cursor's line.
const COMPLETIONS_MAX_HEIGHT = 300

// Width of one indentation level, in columns — matches the 2-space indent
// inserted by the Tab key.
const INDENT_SIZE = 2

// Parse a VS Code-style snippet body (e.g. "foo($1, $2)") into plain text
// and a sorted list of tab-stop positions in document coordinates.
// $0 is treated as the final cursor position (sorted last).
function parseSnippetBody(body: string, insertLine: number, insertCol: number): {
  text: string
  stops: { line: number; col: number }[]
} {
  let text = ''
  const raw: { num: number; line: number; col: number }[] = []
  let curLine = insertLine
  let curCol = insertCol
  let i = 0
  while (i < body.length) {
    if (body[i] === '$') {
      const m = body.slice(i + 1).match(/^(\d+)/)
      if (m) {
        raw.push({ num: parseInt(m[1]), line: curLine, col: curCol })
        i += 1 + m[0].length
        continue
      }
    }
    if (body[i] === '\n') {
      text += '\n'
      curLine++
      curCol = 0
    } else {
      text += body[i]
      curCol++
    }
    i++
  }
  raw.sort((a, b) => {
    if (a.num === 0) return 1
    if (b.num === 0) return -1
    return a.num - b.num
  })
  return { text, stops: raw.map(({ line, col }) => ({ line, col })) }
}

// Extra leading column reserved in the gutter for the git-change /
// diagnostic indicator bar, ahead of the right-aligned line number.
const GUTTER_BAR_COLS = 1

// Width and inset (from the left edge of the gutter) of the indicator bar.
const GUTTER_BAR_WIDTH = 3
const GUTTER_BAR_INSET = 2

// Breathing room (in pixels) around gutter elements: space before the
// indicator bar / line numbers, space between the line number and the
// pin/mark dot, and space on each side of the fold glyph.
const GUTTER_LEFT_PAD = 10
const GUTTER_PIN_PAD = 8
const GUTTER_FOLD_PAD = 8

// Placeholder shown after a collapsed line's text.
const FOLD_PLACEHOLDER = ' ...'

// Total width of the gutter (line numbers, pin-dot column, indicator bar,
// and fold glyph), including padding. Shared by drawing, hit-testing, and
// layout math so they never drift apart.
function computeGutterWidth(lineCount: number, cw: number): number {
  const digits = Math.max(3, String(Math.max(1, lineCount)).length)
  return GUTTER_LEFT_PAD + (digits + GUTTER_BAR_COLS) * cw + GUTTER_PIN_PAD + GUTTER_FOLD_PAD * 2 + cw * 2
}

// X position of the fold glyph's column within the gutter.
function foldGlyphX(gutterWidth: number, cw: number): number {
  return gutterWidth - GUTTER_FOLD_PAD - cw
}

// X position of the pin/mark dot's column, between the line number and the
// fold glyph.
function pinDotX(gutterWidth: number, cw: number): number {
  return foldGlyphX(gutterWidth, cw) - GUTTER_FOLD_PAD - cw
}

const GpuEditor = forwardRef<GpuEditorHandle, Props>(function GpuEditor({
  filePath, fontSize = 13, colors, readOnly = false, minimap = false, indentGuides = false, wordWrap = false,
  gotoLine, gotoToken, viewKey, showHeader = true, diagnostics, gitGutter = true,
  onCursorChange, onLineCountChange, onDirtyChange, onEolChange,
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
  const wheelAccumRef = useRef<number>(0)
  const cursorsRef = useRef<Cursor[]>([{ line: 0, col: 0 }])
  const smartSelectHistoryRef = useRef<Cursor[][]>([])
  const bracketMatchRef = useRef<[[number, number], [number, number]] | null>(null)
  const visibleRowsRef = useRef<number>(1)
  const visibleColsRef = useRef<number>(1)
  const cursorVisibleRef = useRef<boolean>(true)
  const dprRef = useRef<number>(1)
  const readOnlyRef = useRef<boolean>(readOnly)
  readOnlyRef.current = readOnly
  const minimapRef = useRef<boolean>(minimap)
  minimapRef.current = minimap
  const indentGuidesRef = useRef<boolean>(indentGuides)
  indentGuidesRef.current = indentGuides
  const wordWrapRef = useRef<boolean>(wordWrap)
  wordWrapRef.current = wordWrap
  // Code folding: anchor line (0-based) -> last hidden line (inclusive) of
  // the collapsed block. Cleared whenever the line count changes, since
  // anchors would otherwise point at the wrong lines after an edit.
  const foldedRangesRef = useRef<Map<number, number>>(new Map())
  // Pinned/marked lines (0-based) — rendered with a red line number and a
  // red bar in the minimap. Persisted per buffer/view.
  const pinnedLinesRef = useRef<Set<number>>(new Set())
  const minimapGeomRef = useRef<MinimapGeometry>({ firstLine: 0, lastLine: -1, rowHeight: 2 })
  const minimapFetchRef = useRef<(first: number, last: number) => void>(() => {})
  // Forward ref to runSearch (declared later) so edit paths above it can
  // re-run the active find query without reordering the file.
  const runSearchRef = useRef<(jump?: boolean) => Promise<void>>(async () => {})
  const minimapFetchingRef = useRef(false)
  const fontSizeRef = useRef<number>(fontSize)
  const lastGotoLineRef = useRef<number | undefined>(undefined)
  const viewKeyRef = useRef<string | undefined>(viewKey)
  viewKeyRef.current = viewKey
  const dirtyRef = useRef<boolean>(false)

  // Gutter decorations: 0-based line numbers with uncommitted git changes,
  // and 0-based line -> diagnostic severity (0=error, 1=warn) from `diagnostics`.
  const gitChangedLinesRef = useRef<Set<number>>(new Set())
  const diagnosticLinesRef = useRef<Map<number, number>>(new Map())
  // Full diagnostic data per 0-based line, for hover tooltips.
  const diagnosticsByLineRef = useRef<Map<number, Array<{ sev: number; msg: string; code: string }>>>(new Map())

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

  // ── Gutter overlay (pin dots + fold chevrons, rendered as DOM for hover) ─────
  const [gutterOverlay, setGutterOverlay] = useState<GutterOverlayState>({ gutterWidth: 0, cw: 0, ch: 0, rows: [] })
  const gutterOverlayKeyRef = useRef('')

  // ── Diagnostic hover tooltip ─────────────────────────────────────────────────
  const [hoverTooltip, setHoverTooltip] = useState<{ x: number; y: number; items: Array<{ sev: number; msg: string; code: string }> } | null>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoverLineRef = useRef<number | null>(null)

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
  const [completionPos, setCompletionPos] = useState({ x: 0, y: 0, above: false, maxHeight: COMPLETIONS_MAX_HEIGHT })

  const completionOpenRef = useRef(false)
  completionOpenRef.current = completionOpen
  const completionItemsRef = useRef<CompletionItem[]>([])
  completionItemsRef.current = completionItems
  const completionIndexRef = useRef(0)
  completionIndexRef.current = completionIndex
  const completionDebounceRef = useRef<ReturnType<typeof setTimeout>>()

  // ── Snippet tab-stop state ────────────────────────────────────────────────────
  const snippetStopsRef = useRef<{ line: number; col: number }[]>([])
  const snippetStopIdxRef = useRef(0)

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
    const gutterWidth = computeGutterWidth(lineCount, cw)

    renderer.beginFrame(paintRef.current.bg)

    const top = topLineRef.current
    const rows = visibleRowsRef.current
    const left = leftColRef.current
    const cols = visibleColsRef.current
    const cursors = cursorsRef.current
    const { line: curLine } = cursors[0]
    const ranges = cursors.map(rangeOf).filter((r): r is [number, number, number, number] => r !== null)

    const wordWrap = wordWrapRef.current
    // Build a unified display-row list. Non-wrap: one row per visible logical
    // line (startCol = left scroll offset). Wrap: each logical line may yield
    // multiple rows; startCol is the text column that row starts at.
    const displayRows: DisplayRow[] = wordWrap && cols > 0
      ? computeDisplayRows(top, rows, lineCount, foldedRangesRef.current, lineCacheRef.current, cols)
      : computeVisibleLines(top, rows, lineCount, foldedRangesRef.current).map(ln => ({ logicalLine: ln, startCol: left, isFirst: true }))
    const overlayRows: GutterOverlayRow[] = []

    // Current-line highlight — all visual rows of the cursor's logical line.
    for (let row = 0; row < displayRows.length; row++) {
      if (displayRows[row].logicalLine === curLine) {
        renderer.drawRect(0, row * ch, canvas.clientWidth, ch, paintRef.current.currentLine)
      }
    }

    for (let row = 0; row < displayRows.length; row++) {
      const { logicalLine: ln, startCol: rowStart, isFirst } = displayRows[row]
      const data = lineCacheRef.current.get(ln)
      const y = row * ch

      // Gutter decorations only on the first visual row of each logical line.
      if (isFirst) {
        const numStr = String(ln + 1)
        const numX = pinDotX(gutterWidth, cw) - GUTTER_PIN_PAD - numStr.length * cw
        const numColor = pinnedLinesRef.current.has(ln) ? paintRef.current.errorLine
          : ln === curLine ? paintRef.current.gutterActive : paintRef.current.gutter
        renderer.drawText(numX, y, numStr, numColor)

        const sev = diagnosticLinesRef.current.get(ln)
        const barColor = sev === 0 ? paintRef.current.errorLine
          : sev === 1 ? paintRef.current.warningLine
          : gitChangedLinesRef.current.has(ln) ? paintRef.current.gitModified
          : null
        if (barColor) {
          renderer.drawRect(GUTTER_LEFT_PAD + GUTTER_BAR_INSET, y, GUTTER_BAR_WIDTH, ch, barColor)
        }

        const foldEnd = computeFoldEnd(ln, lineCount, lineCacheRef.current)
        overlayRows.push({
          ln, y,
          foldable: foldEnd !== null,
          folded: foldedRangesRef.current.has(ln),
          pinned: pinnedLinesRef.current.has(ln),
          current: ln === curLine,
        })
      }

      if (!data) continue

      // Indent guides — only on the first visual row of each logical line.
      if (indentGuidesRef.current && isFirst) {
        const indentCols = guideIndent(ln, lineCount, lineCacheRef.current)
        for (let col = 0; col < indentCols; col += INDENT_SIZE) {
          const vis = col - rowStart
          if (vis < 0 || vis >= cols) continue
          renderer.drawRect(gutterWidth + vis * cw, y, 1, ch, paintRef.current.indentGuide)
        }
      }

      // Selection backgrounds clipped to this visual row's column range.
      for (const [sLine, sCol, eLine, eCol] of ranges) {
        if (ln >= sLine && ln <= eLine) {
          let from = ln === sLine ? sCol : 0
          let to = ln === eLine ? eCol : data.text.length + 1
          if (wordWrap) {
            from = Math.max(from, rowStart)
            to = Math.min(to, rowStart + cols)
            if (from >= to) continue
          }
          const x0 = gutterWidth + (from - rowStart) * cw
          const x1 = gutterWidth + (to - rowStart) * cw
          renderer.drawRect(Math.max(gutterWidth, x0), y, Math.max(0, x1 - Math.max(gutterWidth, x0)), ch, paintRef.current.selection)
        }
      }

      // Build a per-character style array, then draw runs of matching style,
      // limited to the column range visible in this visual row.
      const text = data.text
      const styleAt = new Uint8Array(text.length)
      for (const [s, e, style] of data.spans) {
        for (let i = Math.max(0, s); i < Math.min(text.length, e); i++) styleAt[i] = style
      }
      const iStart = wordWrap ? rowStart : 0
      const iEnd = wordWrap ? Math.min(text.length, rowStart + cols) : text.length
      let i = iStart
      while (i < iEnd) {
        const st = styleAt[i]
        let j = i + 1
        while (j < iEnd && styleAt[j] === st) j++
        const col = i - rowStart
        if (col + (j - i) > 0 && col < cols) {
          const visStart = Math.max(0, col)
          const skip = visStart - col
          const segment = text.slice(i + skip, i + skip + Math.min(j - i - skip, cols - visStart))
          const x = gutterWidth + visStart * cw
          renderer.drawText(x, y, segment, paintRef.current.styles[st] ?? paintRef.current.styles[0])
        }
        i = j
      }

      // Collapsed-fold placeholder. With wrap, pin it near the right edge of
      // the first (and only) visual row shown for the folded line.
      if (foldedRangesRef.current.has(ln)) {
        const col = wordWrap
          ? Math.min(text.length, Math.max(0, cols - FOLD_PLACEHOLDER.length))
          : text.length - rowStart
        if (col >= 0 && col < cols) {
          renderer.drawText(gutterWidth + Math.max(0, col) * cw, y, FOLD_PLACEHOLDER, paintRef.current.gutter)
        }
      }
    }

    // Matched bracket pair highlight
    if (bracketMatchRef.current) {
      for (const [bLine, bCol] of bracketMatchRef.current) {
        let row = -1
        for (let ri = displayRows.length - 1; ri >= 0; ri--) {
          const r = displayRows[ri]
          if (r.logicalLine === bLine && bCol >= r.startCol) { row = ri; break }
        }
        if (row < 0) continue
        const rowStart = displayRows[row].startCol
        const visCol = bCol - rowStart
        if (visCol >= 0 && visCol < cols) {
          renderer.drawRect(gutterWidth + visCol * cw, row * ch, cw, ch, BRACKET_MATCH_COLOR)
        }
      }
    }

    // Find/replace match highlights — iterate display rows so word-wrap
    // segments within the same logical line each get their slice highlighted.
    const matches = matchesRef.current
    const firstVisLine = displayRows.length > 0 ? displayRows[0].logicalLine : top
    const lastVisLine = displayRows.length > 0 ? displayRows[displayRows.length - 1].logicalLine : top
    for (let mi = 0; mi < matches.length; mi++) {
      const m = matches[mi]
      if (m.endLine < firstVisLine || m.startLine > lastVisLine) continue
      const color = mi === currentMatchRef.current ? paintRef.current.findMatchActive : paintRef.current.findMatch
      for (let ri = 0; ri < displayRows.length; ri++) {
        const r = displayRows[ri]
        if (r.logicalLine < m.startLine || r.logicalLine > m.endLine) continue
        const mdata = lineCacheRef.current.get(r.logicalLine)
        const mFrom = r.logicalLine === m.startLine ? m.startCol : 0
        const mTo = r.logicalLine === m.endLine ? m.endCol : (mdata?.text.length ?? 0) + 1
        const rfrom = wordWrap ? Math.max(mFrom, r.startCol) : mFrom
        const rto = wordWrap ? Math.min(mTo, r.startCol + cols) : mTo
        if (wordWrap && rfrom >= rto) continue
        const x0 = gutterWidth + (rfrom - r.startCol) * cw
        const x1 = gutterWidth + (rto - r.startCol) * cw
        renderer.drawRect(Math.max(gutterWidth, x0), ri * ch, Math.max(0, x1 - Math.max(gutterWidth, x0)), ch, color)
      }
    }

    // Carets — one per cursor, placed on the correct visual row.
    if (cursorVisibleRef.current) {
      for (const c of cursors) {
        let row = -1
        for (let ri = displayRows.length - 1; ri >= 0; ri--) {
          const r = displayRows[ri]
          if (r.logicalLine === c.line && c.col >= r.startCol) { row = ri; break }
        }
        if (row < 0) continue
        const rowStart = displayRows[row].startCol
        const visCol = c.col - rowStart
        if (visCol >= 0 && visCol <= cols) {
          renderer.drawRect(gutterWidth + visCol * cw, row * ch, 2, ch, paintRef.current.cursor)
        }
      }
    }

    // Sync the DOM gutter overlay (pin dots + fold chevrons). Skipped when
    // nothing relevant changed so the cursor-blink redraw (every 530ms)
    // doesn't trigger a React re-render.
    const overlayKey = `${gutterWidth}|${cw}|${ch}|` + overlayRows.map(r =>
      `${r.ln}:${r.foldable ? 1 : 0}${r.folded ? 1 : 0}${r.pinned ? 1 : 0}${r.current ? 1 : 0}`
    ).join(',')
    if (overlayKey !== gutterOverlayKeyRef.current) {
      gutterOverlayKeyRef.current = overlayKey
      setGutterOverlay({ gutterWidth, cw, ch, rows: overlayRows })
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
          geom, pinnedLinesRef.current, paintRef.current.errorLine,
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

  // Refresh the git-change gutter bar for the current file. Best-effort —
  // silently no-ops outside a git repo (or if git isn't available).
  const fetchGitGutter = useCallback(async () => {
    const sep = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
    if (sep < 0) return
    const dir = filePath.slice(0, sep)
    const name = filePath.slice(sep + 1)
    try {
      const { diff, untracked } = await git.diffLines(dir, name)
      gitChangedLinesRef.current = parseChangedLines(diff, untracked, lineCountRef.current)
      draw()
    } catch { /* not a git repo */ }
  }, [filePath, draw])

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

  // After an edit, drop only the cache entries that may now be stale instead
  // of clearing everything. The immediate draw() that follows an edit would
  // otherwise render the whole viewport blank (cache empty) until the
  // editor.lines round-trip resolves, producing a visible flash on every
  // keystroke. If the line count didn't change, only [dirtyStart, dirtyEnd]
  // can have changed. If it did change, every line at/after dirtyStart has
  // shifted to a different index and must be refetched.
  const invalidateDirtyLines = useCallback((prevLineCount: number, newLineCount: number, dirtyStart: number, dirtyEnd: number) => {
    if (newLineCount !== prevLineCount) {
      for (const ln of Array.from(lineCacheRef.current.keys())) {
        if (ln >= dirtyStart) lineCacheRef.current.delete(ln)
      }
    } else {
      for (let ln = dirtyStart; ln <= dirtyEnd; ln++) lineCacheRef.current.delete(ln)
    }
  }, [])

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
    const gutterWidth = computeGutterWidth(lineCountRef.current, renderer.cellWidth)
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
    if (isLineHidden(topLineRef.current, foldedRangesRef.current)) {
      topLineRef.current = nextVisibleLine(topLineRef.current, foldedRangesRef.current)
    }
    leftColRef.current = wordWrapRef.current ? 0 : Math.max(0, leftColRef.current)
  }, [])

  const ensureCursorVisible = useCallback(() => {
    const { line, col } = cursorsRef.current[0]
    const rows = visibleRowsRef.current
    const cols = visibleColsRef.current
    if (wordWrapRef.current) {
      if (line < topLineRef.current) {
        topLineRef.current = line
      } else if (line > topLineRef.current) {
        const vrows = computeDisplayRows(topLineRef.current, rows, lineCountRef.current, foldedRangesRef.current, lineCacheRef.current, cols)
        if (!vrows.some(r => r.logicalLine === line)) topLineRef.current = line
      }
      leftColRef.current = 0
    } else {
      if (line < topLineRef.current) topLineRef.current = line
      else if (line >= topLineRef.current + rows) topLineRef.current = line - rows + 1
      if (col < leftColRef.current) leftColRef.current = col
      else if (col >= leftColRef.current + cols) leftColRef.current = col - cols + 1
    }
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

  // Pixel position for the completions popup, anchored to the primary
  // cursor's line. Placed below the line by default, but flipped above it
  // when there isn't enough room beneath (e.g. the cursor is near the
  // bottom of the viewport).
  const cursorPixelPos = useCallback(() => {
    const renderer = rendererRef.current
    const { line, col } = cursorsRef.current[0]
    if (!renderer) return { x: 0, y: 0, above: false, maxHeight: COMPLETIONS_MAX_HEIGHT }
    const gutterWidth = computeGutterWidth(lineCountRef.current, renderer.cellWidth)
    let x: number, rowIndex: number
    if (wordWrapRef.current) {
      const wrapCols = visibleColsRef.current
      const visRows = computeDisplayRows(topLineRef.current, visibleRowsRef.current, lineCountRef.current, foldedRangesRef.current, lineCacheRef.current, wrapCols)
      let found = -1
      for (let ri = visRows.length - 1; ri >= 0; ri--) {
        if (visRows[ri].logicalLine === line && visRows[ri].startCol <= col) { found = ri; break }
      }
      if (found < 0) {
        rowIndex = Math.max(0, line - topLineRef.current)
        x = gutterWidth + (wrapCols > 0 ? col % wrapCols : col) * renderer.cellWidth
      } else {
        rowIndex = found
        x = gutterWidth + (col - visRows[found].startCol) * renderer.cellWidth
      }
    } else {
      x = gutterWidth + (col - leftColRef.current) * renderer.cellWidth
      const visLines = computeVisibleLines(topLineRef.current, visibleRowsRef.current, lineCountRef.current, foldedRangesRef.current)
      const row = visLines.indexOf(line)
      rowIndex = row >= 0 ? row : line - topLineRef.current
    }
    const rowTop = rowIndex * renderer.cellHeight
    const rowBottom = rowTop + renderer.cellHeight
    const containerHeight = containerRef.current?.clientHeight ?? 0
    const spaceBelow = containerHeight - rowBottom
    const spaceAbove = rowTop
    const above = spaceBelow < COMPLETIONS_MAX_HEIGHT && spaceAbove > spaceBelow
    const maxHeight = Math.max(100, Math.min(COMPLETIONS_MAX_HEIGHT, (above ? spaceAbove : spaceBelow) - 8))
    return { x, y: above ? rowTop : rowBottom, above, maxHeight }
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

  const advanceSnippetStop = useCallback(() => {
    const stops = snippetStopsRef.current
    const nextIdx = snippetStopIdxRef.current + 1
    if (nextIdx >= stops.length) {
      snippetStopsRef.current = []
      return
    }
    snippetStopIdxRef.current = nextIdx
    const stop = stops[nextIdx]
    cursorsRef.current = [{ line: stop.line, col: stop.col }]
    notifyCursor()
    ensureCursorVisible()
    draw()
  }, [draw, ensureCursorVisible, notifyCursor])

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
    const prevLineCount = lineCountRef.current
    versionRef.current = resp.version
    lineCountRef.current = resp.lineCount
    if (resp.lineCount !== prevLineCount) foldedRangesRef.current.clear()
    shiftLineSet(pinnedLinesRef.current, prevLineCount, resp.lineCount, resp.dirtyStart, resp.dirtyEnd)
    shiftLineSet(gitChangedLinesRef.current, prevLineCount, resp.lineCount, resp.dirtyStart, resp.dirtyEnd)
    markLinesChanged(gitChangedLinesRef.current, resp.dirtyStart, resp.dirtyEnd, resp.lineCount)
    invalidateDirtyLines(prevLineCount, resp.lineCount, resp.dirtyStart, resp.dirtyEnd)

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
    if (findOpenRef.current) void runSearchRef.current(false)
  }, [draw, ensureCursorVisible, fetchVisible, invalidateDirtyLines, notifyCursor, notifyDirty, updateBracketMatch])

  // Replace the identifier prefix immediately left of the cursor with the
  // selected completion's insertText, or expand its snippet body if present.
  const acceptCompletion = useCallback(async () => {
    const item = completionItemsRef.current[completionIndexRef.current]
    closeCompletions()
    if (!item) return
    const { line, col } = cursorsRef.current[0]
    const data = await ensureLine(line)
    const text = data?.text ?? ''
    let start = col
    while (start > 0 && /[A-Za-z0-9_]/.test(text[start - 1])) start--

    if (item.snippet) {
      const { text: snippetText, stops } = parseSnippetBody(item.snippet, line, start)
      const firstStop = stops[0]
      await applyMultiEdit([{
        idx: 0,
        range: [line, start, line, col],
        text: snippetText,
        cursor: firstStop ? { lineOffset: firstStop.line - line, col: firstStop.col } : undefined,
      }])
      if (stops.length > 0) {
        snippetStopsRef.current = stops
        snippetStopIdxRef.current = 0
      }
    } else {
      await applyMultiEdit([{ idx: 0, range: [line, start, line, col], text: item.insertText }])
    }
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
    const prevLineCount = lineCountRef.current
    versionRef.current = resp.version
    lineCountRef.current = resp.lineCount
    if (resp.lineCount !== prevLineCount) foldedRangesRef.current.clear()
    if (resp.dirtyStart !== undefined && resp.dirtyEnd !== undefined) {
      shiftLineSet(pinnedLinesRef.current, prevLineCount, resp.lineCount, resp.dirtyStart, resp.dirtyEnd)
      shiftLineSet(gitChangedLinesRef.current, prevLineCount, resp.lineCount, resp.dirtyStart, resp.dirtyEnd)
      markLinesChanged(gitChangedLinesRef.current, resp.dirtyStart, resp.dirtyEnd, resp.lineCount)
      invalidateDirtyLines(prevLineCount, resp.lineCount, resp.dirtyStart, resp.dirtyEnd)
    } else {
      if (resp.lineCount !== prevLineCount) pinnedLinesRef.current.clear()
      lineCacheRef.current.clear()
    }
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
  }, [closeCompletions, draw, ensureCursorVisible, fetchVisible, invalidateDirtyLines, notifyCursor, notifyDirty, updateBracketMatch])

  const undo = useCallback(() => applyUndoRedo('editor.undo'), [applyUndoRedo])
  const redo = useCallback(() => applyUndoRedo('editor.redo'), [applyUndoRedo])

  const save = useCallback(async () => {
    if (readOnlyRef.current) return
    await invoke('editor.save', { bufferId: bufferIdRef.current })
    setStatus('')
    notifyDirty(false)
    if (gitGutter) void fetchGitGutter()
  }, [notifyDirty, fetchGitGutter, gitGutter])

  // ── Find / replace ──────────────────────────────────────────────────────────

  // Move the caret/selection onto a search match and scroll it into view.
  const jumpToMatch = useCallback((idx: number) => {
    const m = matchesRef.current[idx]
    if (!m) return
    currentMatchRef.current = idx
    setCurrentMatch(idx)
    cursorsRef.current = [{ line: m.endLine, col: m.endCol, anchorLine: m.startLine, anchorCol: m.startCol }]
    cursorVisibleRef.current = true
    notifyCursor()
    ensureCursorVisible()
    fetchVisible()
    draw()
  }, [draw, ensureCursorVisible, fetchVisible, notifyCursor])

  // Re-run editor.search with the current query/options and pick the match
  // nearest the primary cursor as "current". Fire-and-forget.
  const runSearch = useCallback(async (jump = true) => {
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
      if (idx === -1) {
        currentMatchRef.current = -1
        setCurrentMatch(-1)
        draw()
      } else if (jump) {
        jumpToMatch(idx)
      } else {
        currentMatchRef.current = idx
        setCurrentMatch(idx)
        draw()
      }
    } catch {
      matchesRef.current = []
      currentMatchRef.current = -1
      setMatchCount(0)
      setCurrentMatch(-1)
      draw()
    }
  }, [draw, jumpToMatch])
  runSearchRef.current = runSearch

  // Apply a batch of edits (already in document coordinates, any order) —
  // used by replace/replace-all, which build their edits from a search-match
  // snapshot rather than per-cursor like applyMultiEdit.
  const applyRawEdits = useCallback(async (edits: { startLine: number; startCol: number; endLine: number; endCol: number; text: string }[]) => {
    if (edits.length === 0 || readOnlyRef.current) return
    const sorted = [...edits].sort((a, b) => b.startLine - a.startLine || b.startCol - a.startCol)
    const resp = await invoke<{ version: number; lineCount: number; dirtyStart: number; dirtyEnd: number }>('editor.edit', {
      bufferId: bufferIdRef.current, edits: sorted,
    })
    const prevLineCount = lineCountRef.current
    versionRef.current = resp.version
    lineCountRef.current = resp.lineCount
    if (resp.lineCount !== prevLineCount) foldedRangesRef.current.clear()
    shiftLineSet(pinnedLinesRef.current, prevLineCount, resp.lineCount, resp.dirtyStart, resp.dirtyEnd)
    shiftLineSet(gitChangedLinesRef.current, prevLineCount, resp.lineCount, resp.dirtyStart, resp.dirtyEnd)
    markLinesChanged(gitChangedLinesRef.current, resp.dirtyStart, resp.dirtyEnd, resp.lineCount)
    invalidateDirtyLines(prevLineCount, resp.lineCount, resp.dirtyStart, resp.dirtyEnd)
    setStatus('●')
    notifyDirty(true)
    onLineCountChangeRef.current?.(lineCountRef.current)
    fetchVisible()
    draw()
    void updateBracketMatch()
  }, [draw, fetchVisible, invalidateDirtyLines, notifyDirty, updateBracketMatch])

  // Enter/Shift+Enter — select the next/previous match, wrapping around.
  const gotoMatch = useCallback((delta: number) => {
    const n = matchesRef.current.length
    if (n === 0) return
    closeCompletions()
    jumpToMatch(((currentMatchRef.current + delta) % n + n) % n)
  }, [closeCompletions, jumpToMatch])

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

  // Reads the text under each cursor's selection straight from the backend
  // (the hidden textarea's value is kept empty, so native Ctrl+C has nothing
  // to copy) and joins them the way VS Code does for multi-cursor copies.
  const copySelection = useCallback(async () => {
    const ranges = cursorsRef.current.map(rangeOf).filter((r): r is [number, number, number, number] => r !== null)
    if (ranges.length === 0) return
    const texts = await Promise.all(ranges.map(async ([sl, sc, el, ec]) => {
      if (sl === el) {
        const data = await ensureLine(sl)
        return (data?.text ?? '').slice(sc, ec)
      }
      const parts: string[] = []
      for (let ln = sl; ln <= el; ln++) {
        const text = (await ensureLine(ln))?.text ?? ''
        parts.push(ln === sl ? text.slice(sc) : ln === el ? text.slice(0, ec) : text)
      }
      return parts.join('\n')
    }))
    await navigator.clipboard.writeText(texts.join('\n'))
  }, [ensureLine])

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
    smartSelectHistoryRef.current = []
    const cursors = cursorsRef.current
    const next: Cursor[] = []
    for (const c of cursors) {
      let anchorLine = c.anchorLine, anchorCol = c.anchorCol
      if (!extend) { anchorLine = undefined; anchorCol = undefined }
      else if (anchorLine === undefined) { anchorLine = c.line; anchorCol = c.col }

      let { line, col } = c
      if (dl !== 0) {
        const wrapCols = visibleColsRef.current
        if (wordWrapRef.current && (dl === 1 || dl === -1) && wrapCols > 0) {
          const data = await ensureLine(line)
          const lineLen = data?.text.length ?? 0
          const visualCol = col % wrapCols
          if (dl === -1) {
            if (col >= wrapCols) {
              col = col - wrapCols
            } else {
              line = Math.max(0, line - 1)
              const prevData = await ensureLine(line)
              const prevLen = prevData?.text.length ?? 0
              const lastRowStart = Math.floor(prevLen / wrapCols) * wrapCols
              col = Math.min(lastRowStart + visualCol, prevLen)
            }
          } else {
            const nextRowStart = Math.floor(col / wrapCols) * wrapCols + wrapCols
            if (nextRowStart <= lineLen) {
              col = Math.min(nextRowStart + visualCol, lineLen)
            } else {
              line = Math.min(lineCountRef.current - 1, line + 1)
              const nextData = await ensureLine(line)
              col = Math.min(visualCol, nextData?.text.length ?? 0)
            }
          }
        } else {
          line = Math.max(0, Math.min(lineCountRef.current - 1, line + dl))
          const data = await ensureLine(line)
          col = Math.min(col, data?.text.length ?? 0)
        }
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
      if (isLineHidden(line, foldedRangesRef.current)) unfoldContaining(line, foldedRangesRef.current)
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
      if (isLineHidden(line, foldedRangesRef.current)) unfoldContaining(line, foldedRangesRef.current)
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
    if (isLineHidden(line, foldedRangesRef.current)) unfoldContaining(line, foldedRangesRef.current)
    cursorsRef.current = [{ line, col, anchorLine, anchorCol }]
    cursorVisibleRef.current = true
    notifyCursor()
    ensureCursorVisible()
    fetchVisible()
    draw()
    void updateBracketMatch()
  }, [closeCompletions, draw, ensureCursorVisible, ensureLine, fetchVisible, notifyCursor, updateBracketMatch])

  const selectAll = useCallback(async () => {
    closeCompletions()
    const lastLine = lineCountRef.current - 1
    const data = await ensureLine(lastLine)
    cursorsRef.current = [{ line: lastLine, col: data?.text.length ?? 0, anchorLine: 0, anchorCol: 0 }]
    cursorVisibleRef.current = true
    notifyCursor()
    ensureCursorVisible()
    fetchVisible()
    draw()
    void updateBracketMatch()
  }, [closeCompletions, draw, ensureCursorVisible, ensureLine, fetchVisible, notifyCursor, updateBracketMatch])

  // Double-click — select the word (or punctuation/whitespace run) under the
  // given position. Classifies characters into word/whitespace/punctuation
  // and expands the selection to cover the contiguous run of the same class.
  const selectWordAt = useCallback(async (line: number, col: number) => {
    closeCompletions()
    line = Math.max(0, Math.min(lineCountRef.current - 1, line))
    const data = await ensureLine(line)
    const text = data?.text ?? ''
    if (text.length === 0) {
      cursorsRef.current = [{ line, col: 0 }]
    } else {
      const idx = Math.max(0, Math.min(text.length - 1, col))
      const classOf = (c: string) => /\s/.test(c) ? 0 : /[A-Za-z0-9_]/.test(c) ? 1 : 2
      const cls = classOf(text[idx])
      let start = idx, end = idx + 1
      while (start > 0 && classOf(text[start - 1]) === cls) start--
      while (end < text.length && classOf(text[end]) === cls) end++
      cursorsRef.current = [{ line, col: end, anchorLine: line, anchorCol: start }]
    }
    cursorVisibleRef.current = true
    notifyCursor()
    ensureCursorVisible()
    fetchVisible()
    draw()
    void updateBracketMatch()
  }, [closeCompletions, draw, ensureCursorVisible, ensureLine, fetchVisible, notifyCursor, updateBracketMatch])

  // Shift+Alt+Right/Left — expand or shrink the selection by AST node.
  const expandSmartSelect = useCallback(async () => {
    if (!bufferIdRef.current) return
    const c = cursorsRef.current[0]
    // Normalize current selection: [anchorLine/Col, line/col] ordered by position.
    let sl = c.anchorLine ?? c.line
    let sc = c.anchorCol  ?? c.col
    let el = c.line
    let ec = c.col
    if (el < sl || (el === sl && ec < sc)) {
      [sl, sc, el, ec] = [el, ec, sl, sc]
    }
    const resp = await invoke<{
      noop?: boolean; startLine: number; startCol: number; endLine: number; endCol: number
    }>('editor.smartSelect', { bufferId: bufferIdRef.current, startLine: sl, startCol: sc, endLine: el, endCol: ec })
    if (resp.noop) return
    // Save current cursors so shrink can restore them.
    smartSelectHistoryRef.current.push(cursorsRef.current.map(x => ({ ...x })))
    // Anchor at start, active end at end of expanded node.
    cursorsRef.current = [{ line: resp.endLine, col: resp.endCol, anchorLine: resp.startLine, anchorCol: resp.startCol }]
    cursorVisibleRef.current = true
    notifyCursor()
    ensureCursorVisible()
    fetchVisible()
    draw()
    void updateBracketMatch()
  }, [draw, ensureCursorVisible, fetchVisible, notifyCursor, updateBracketMatch])

  const shrinkSmartSelect = useCallback(() => {
    const prev = smartSelectHistoryRef.current.pop()
    if (!prev) return
    cursorsRef.current = prev
    cursorVisibleRef.current = true
    notifyCursor()
    ensureCursorVisible()
    fetchVisible()
    draw()
    void updateBracketMatch()
  }, [draw, ensureCursorVisible, fetchVisible, notifyCursor, updateBracketMatch])

  // Triple-click — select the entire line.
  const selectLineAt = useCallback(async (line: number) => {
    closeCompletions()
    line = Math.max(0, Math.min(lineCountRef.current - 1, line))
    const data = await ensureLine(line)
    const len = data?.text.length ?? 0
    cursorsRef.current = [{ line, col: len, anchorLine: line, anchorCol: 0 }]
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

  // Returns the union of all line indices touched by any cursor or selection.
  function touchedLines(cursors: Cursor[]): [number, number] {
    let first = Infinity, last = -Infinity
    for (const c of cursors) {
      const r = rangeOf(c)
      if (r) { first = Math.min(first, r[0]); last = Math.max(last, r[2]) }
      else { first = Math.min(first, c.line); last = Math.max(last, c.line) }
    }
    return [first, last]
  }

  // Shared post-edit housekeeping for line move/copy operations.
  const applyLineEdit = useCallback(async (
    edit: { startLine: number; startCol: number; endLine: number; endCol: number; text: string },
    newCursors: Cursor[],
  ) => {
    if (readOnlyRef.current) return
    const resp = await invoke<{ version: number; lineCount: number; dirtyStart: number; dirtyEnd: number }>('editor.edit', {
      bufferId: bufferIdRef.current, edits: [edit],
    })
    const prevLineCount = lineCountRef.current
    versionRef.current = resp.version
    lineCountRef.current = resp.lineCount
    if (resp.lineCount !== prevLineCount) foldedRangesRef.current.clear()
    shiftLineSet(pinnedLinesRef.current, prevLineCount, resp.lineCount, resp.dirtyStart, resp.dirtyEnd)
    shiftLineSet(gitChangedLinesRef.current, prevLineCount, resp.lineCount, resp.dirtyStart, resp.dirtyEnd)
    markLinesChanged(gitChangedLinesRef.current, resp.dirtyStart, resp.dirtyEnd, resp.lineCount)
    invalidateDirtyLines(prevLineCount, resp.lineCount, resp.dirtyStart, resp.dirtyEnd)
    cursorsRef.current = newCursors
    cursorVisibleRef.current = true
    setStatus('●')
    notifyDirty(true)
    onLineCountChangeRef.current?.(lineCountRef.current)
    notifyCursor()
    ensureCursorVisible()
    fetchVisible()
    draw()
    void updateBracketMatch()
    if (findOpenRef.current) void runSearchRef.current(false)
  }, [draw, ensureCursorVisible, fetchVisible, invalidateDirtyLines, notifyCursor, notifyDirty, updateBracketMatch])

  // Alt+Up — swap the block of lines touched by any cursor/selection with the line above.
  const moveLineUp = useCallback(async () => {
    closeCompletions()
    const cursors = cursorsRef.current
    const [firstLine, lastLine] = touchedLines(cursors)
    if (firstLine === 0) return
    const lineTexts: string[] = []
    for (let ln = firstLine - 1; ln <= lastLine; ln++) {
      lineTexts.push((await ensureLine(ln))?.text ?? '')
    }
    const aboveText = lineTexts[0]
    const movedTexts = lineTexts.slice(1)
    const newText = movedTexts.join('\n') + '\n' + aboveText
    const endCol = lineTexts[lineTexts.length - 1].length
    const newCursors = cursors.map(c => ({
      ...c,
      line: c.line - 1,
      ...(c.anchorLine !== undefined ? { anchorLine: c.anchorLine - 1 } : {}),
    }))
    await applyLineEdit({ startLine: firstLine - 1, startCol: 0, endLine: lastLine, endCol, text: newText }, newCursors)
  }, [applyLineEdit, closeCompletions, ensureLine])

  // Alt+Down — swap the block of lines touched by any cursor/selection with the line below.
  const moveLineDown = useCallback(async () => {
    closeCompletions()
    const cursors = cursorsRef.current
    const [firstLine, lastLine] = touchedLines(cursors)
    if (lastLine >= lineCountRef.current - 1) return
    const lineTexts: string[] = []
    for (let ln = firstLine; ln <= lastLine + 1; ln++) {
      lineTexts.push((await ensureLine(ln))?.text ?? '')
    }
    const belowText = lineTexts[lineTexts.length - 1]
    const movedTexts = lineTexts.slice(0, -1)
    const newText = belowText + '\n' + movedTexts.join('\n')
    const endCol = belowText.length
    const newCursors = cursors.map(c => ({
      ...c,
      line: c.line + 1,
      ...(c.anchorLine !== undefined ? { anchorLine: c.anchorLine + 1 } : {}),
    }))
    await applyLineEdit({ startLine: firstLine, startCol: 0, endLine: lastLine + 1, endCol, text: newText }, newCursors)
  }, [applyLineEdit, closeCompletions, ensureLine])

  // Shift+Alt+Up — insert a duplicate of the touched lines immediately above; cursor follows original content down.
  const copyLineUp = useCallback(async () => {
    closeCompletions()
    const cursors = cursorsRef.current
    const [firstLine, lastLine] = touchedLines(cursors)
    const lineTexts: string[] = []
    for (let ln = firstLine; ln <= lastLine; ln++) {
      lineTexts.push((await ensureLine(ln))?.text ?? '')
    }
    const blockText = lineTexts.join('\n') + '\n'
    const count = lastLine - firstLine + 1
    const newCursors = cursors.map(c => ({
      ...c,
      line: c.line + count,
      ...(c.anchorLine !== undefined ? { anchorLine: c.anchorLine + count } : {}),
    }))
    await applyLineEdit({ startLine: firstLine, startCol: 0, endLine: firstLine, endCol: 0, text: blockText }, newCursors)
  }, [applyLineEdit, closeCompletions, ensureLine])

  // Shift+Alt+Down — insert a duplicate of the touched lines immediately below; cursor stays on original.
  const copyLineDown = useCallback(async () => {
    closeCompletions()
    const cursors = cursorsRef.current
    const [firstLine, lastLine] = touchedLines(cursors)
    const lineTexts: string[] = []
    for (let ln = firstLine; ln <= lastLine; ln++) {
      lineTexts.push((await ensureLine(ln))?.text ?? '')
    }
    const blockText = '\n' + lineTexts.join('\n')
    const endCol = lineTexts[lineTexts.length - 1].length
    await applyLineEdit({ startLine: lastLine, startCol: endCol, endLine: lastLine, endCol, text: blockText }, cursors.slice())
  }, [applyLineEdit, closeCompletions, ensureLine])

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
      foldedRangesRef.current.clear()

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
      pinnedLinesRef.current = new Set(vs.pinnedLines ?? [])

      dirtyRef.current = open.dirty
      onDirtyChangeRef.current?.(open.dirty)
      onLineCountChangeRef.current?.(open.lineCount)
      onEolChangeRef.current?.(open.eol)
      notifyCursor()

      recomputeViewport()
      setReady(true)
      if (gitGutter) void fetchGitGutter()
      // Read-only instances (e.g. the workflow code preview, which stays
      // mounted in a background overlay) must never grab keyboard focus —
      // doing so on every filePath change steals focus from whichever
      // editor the user is actually typing into.
      if (!readOnlyRef.current) textareaRef.current?.focus()
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
            pinnedLines: Array.from(pinnedLinesRef.current),
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

  // Re-derive the per-line diagnostic maps whenever diagnostics change.
  // diagnosticLinesRef: 0-based line -> most severe sev (lowest number).
  // diagnosticsByLineRef: 0-based line -> all diagnostics (errors first).
  useEffect(() => {
    const map = new Map<number, number>()
    const byLine = new Map<number, Array<{ sev: number; msg: string; code: string }>>()
    for (const d of diagnostics ?? []) {
      const ln = d.line - 1
      const existing = map.get(ln)
      if (existing === undefined || d.sev < existing) map.set(ln, d.sev)
      const arr = byLine.get(ln) ?? []
      arr.push({ sev: d.sev, msg: d.msg, code: d.code })
      byLine.set(ln, arr)
    }
    for (const arr of byLine.values()) arr.sort((a, b) => a.sev - b.sev)
    diagnosticLinesRef.current = map
    diagnosticsByLineRef.current = byLine
    draw()
  }, [diagnostics, draw])

  // External font-size changes (e.g. global zoom-level config) reset any
  // local Ctrl+wheel zoom applied to this instance.
  useEffect(() => {
    if (!ready) return
    fontSizeRef.current = fontSize
    rendererRef.current?.setFont(FONT_FAMILY, fontSize)
    recomputeViewport()
    draw()
  }, [fontSize, ready, recomputeViewport, draw])

  // Jump to the requested line (1-based) whenever gotoToken changes, pinning
  // that line at the top of the visible area. Using gotoToken (not gotoLine)
  // as the change key means repeat navigations to the same line also fire.
  const lastGotoTokenRef = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (!ready || gotoLine === undefined) return
    if (gotoToken !== undefined && gotoToken === lastGotoTokenRef.current) return
    lastGotoTokenRef.current = gotoToken
    lastGotoLineRef.current = gotoLine
    const target = Math.max(0, gotoLine - 1)
    void setCursorTo(target, 0, false).then(() => {
      topLineRef.current = target
      clampScroll()
      draw()
      textareaRef.current?.focus()
    })
  }, [gotoLine, gotoToken, ready, setCursorTo, clampScroll, draw])

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

  // Toggling indent guides only affects rendering, not layout.
  useEffect(() => {
    if (!ready) return
    draw()
  }, [indentGuides, ready, draw])

  // Toggling word wrap resets horizontal scroll and re-lays-out the viewport.
  useEffect(() => {
    if (!ready) return
    if (wordWrap) leftColRef.current = 0
    recomputeViewport()
    draw()
  }, [wordWrap, ready, recomputeViewport, draw])

  // ── Input handlers ──────────────────────────────────────────────────────────

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const shift = e.shiftKey

    if (snippetStopsRef.current.length > 0) {
      if (e.key === 'Tab') {
        e.preventDefault()
        advanceSnippetStop()
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        snippetStopsRef.current = []
        return
      }
      // Any other key exits snippet mode and falls through to normal handling.
      snippetStopsRef.current = []
    }

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
        if (e.altKey && e.shiftKey) { e.preventDefault(); void copyLineUp(); return }
        if (e.altKey) { e.preventDefault(); void moveLineUp(); return }
        e.preventDefault(); void moveCursor(-1, 0, shift); return
      case 'ArrowDown':
        if (e.ctrlKey && e.altKey) { e.preventDefault(); void addCursorVertical(1); return }
        if (e.altKey && e.shiftKey) { e.preventDefault(); void copyLineDown(); return }
        if (e.altKey) { e.preventDefault(); void moveLineDown(); return }
        e.preventDefault(); void moveCursor(1, 0, shift); return
      case 'ArrowLeft':
        if (e.shiftKey && e.altKey) { e.preventDefault(); shrinkSmartSelect(); return }
        e.preventDefault(); void moveCursor(0, -1, shift); return
      case 'ArrowRight':
        if (e.shiftKey && e.altKey) { e.preventDefault(); void expandSmartSelect(); return }
        e.preventDefault(); void moveCursor(0, 1, shift); return
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
      case 'a':
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); void selectAll() }
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
      case 'c':
        if ((e.ctrlKey || e.metaKey) && rangeOf(cursorsRef.current[0])) {
          e.preventDefault()
          void copySelection()
        }
        return
      case 'x':
        if ((e.ctrlKey || e.metaKey) && !readOnlyRef.current && rangeOf(cursorsRef.current[0])) {
          e.preventDefault()
          void copySelection().then(() => deleteForward())
        }
        return
      default:
        if (!e.ctrlKey && !e.metaKey && !e.altKey && (AUTO_CLOSE_PAIRS[e.key] !== undefined || AUTO_CLOSE_CLOSERS.has(e.key))) {
          e.preventDefault()
          void handleTypedChar(e.key)
        }
        return
    }
  }, [acceptCompletion, addCursorVertical, advanceSnippetStop, closeCompletions, closeFind, copyLineDown, copyLineUp, copySelection, deleteBackward, deleteForward, draw, expandSmartSelect, handleEnter, handleTypedChar, insertText, moveCursor, moveCursorsTo, moveLineDown, moveLineUp, openFind, redo, requestCompletions, save, selectAll, shrinkSmartSelect, undo])

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
    const gutterWidth = computeGutterWidth(lineCountRef.current, renderer.cellWidth)
    const x = clientX - rect.left - gutterWidth
    const y = clientY - rect.top
    const rowIdx = Math.max(0, Math.floor(y / renderer.cellHeight))
    if (wordWrapRef.current) {
      const wrapCols = visibleColsRef.current
      const visRows = computeDisplayRows(topLineRef.current, rowIdx + 1, lineCountRef.current, foldedRangesRef.current, lineCacheRef.current, wrapCols)
      const vr = rowIdx < visRows.length ? visRows[rowIdx] : visRows[visRows.length - 1]
      if (!vr) return null
      const col = vr.startCol + Math.round(x / renderer.cellWidth)
      return { line: vr.logicalLine, col: Math.max(0, col) }
    }
    const visLines = computeVisibleLines(topLineRef.current, rowIdx + 1, lineCountRef.current, foldedRangesRef.current)
    const line = rowIdx < visLines.length ? visLines[rowIdx] : Math.max(0, lineCountRef.current - 1)
    const col = leftColRef.current + Math.round(x / renderer.cellWidth)
    return { line: Math.max(0, line), col: Math.max(0, col) }
  }, [])

  const draggingRef = useRef(false)

  // Toggle the fold anchored at `ln`, if it opens an indented block.
  const toggleFold = useCallback((ln: number) => {
    const foldEnd = computeFoldEnd(ln, lineCountRef.current, lineCacheRef.current)
    if (foldEnd === null) return
    if (foldedRangesRef.current.has(ln)) foldedRangesRef.current.delete(ln)
    else foldedRangesRef.current.set(ln, foldEnd)
    clampScroll()
    fetchVisible()
    draw()
  }, [clampScroll, draw, fetchVisible])

  // Toggle the pin/mark on line `ln`.
  const togglePin = useCallback((ln: number) => {
    if (pinnedLinesRef.current.has(ln)) pinnedLinesRef.current.delete(ln)
    else pinnedLinesRef.current.add(ln)
    draw()
  }, [draw])

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // Canvas isn't focusable, so the browser's default mousedown action would
    // blur the hidden textarea and shift focus to <body>, undoing the
    // focus() call below. Preventing that default keeps the textarea focused
    // so keystrokes keep reaching the editor.
    e.preventDefault()
    textareaRef.current?.focus()
    const pos = pixelToPos(e.clientX, e.clientY)
    if (!pos) return
    if (e.ctrlKey) {
      togglePin(pos.line)
      return
    }
    if (e.altKey) {
      void addCursorAt(pos.line, pos.col)
      return
    }
    if (e.detail >= 3) { draggingRef.current = true; void selectLineAt(pos.line); return }
    if (e.detail >= 2) { draggingRef.current = true; return } // double-click: let onDoubleClick handle word selection
    draggingRef.current = true
    void setCursorTo(pos.line, pos.col, e.shiftKey)
  }, [addCursorAt, pixelToPos, selectLineAt, setCursorTo, togglePin])

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (draggingRef.current) {
      // Clear hover during drag selection.
      if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null }
      setHoverTooltip(null)
      hoverLineRef.current = null
      // The mouse button may have been released outside the canvas (e.g. over
      // the file explorer or tab bar) — that mouseup never reaches our handler
      // since it's only bound to this element, leaving draggingRef stuck true.
      // Bail out (and stop tracking) if the primary button is no longer down.
      if (e.buttons === 0) { draggingRef.current = false; return }
      const pos = pixelToPos(e.clientX, e.clientY)
      if (!pos) return
      void setCursorTo(pos.line, pos.col, true)
      return
    }

    // Hover: check if we moved to a different line.
    const pos = pixelToPos(e.clientX, e.clientY)
    if (!pos || pos.line === hoverLineRef.current) return
    if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null }
    setHoverTooltip(null)
    hoverLineRef.current = pos.line
    const items = diagnosticsByLineRef.current.get(pos.line)
    if (!items || items.length === 0) return
    const cx = e.clientX
    const cy = e.clientY
    hoverTimerRef.current = setTimeout(() => {
      hoverTimerRef.current = null
      if (hoverLineRef.current !== pos.line) return
      const container = containerRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      setHoverTooltip({ x: cx - rect.left + 14, y: cy - rect.top + 18, items })
    }, 400)
  }, [pixelToPos, setCursorTo])

  const onMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null }
    hoverLineRef.current = null
    setHoverTooltip(null)
  }, [])

  const onMouseUp = useCallback(() => { draggingRef.current = false }, [])

  const onDoubleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.detail >= 3) return // handled in onMouseDown
    const pos = pixelToPos(e.clientX, e.clientY)
    if (!pos) return
    e.preventDefault()
    textareaRef.current?.focus()
    void selectWordAt(pos.line, pos.col)
  }, [pixelToPos, selectWordAt])

  // Drag-selection can extend outside the canvas; a mouseup there wouldn't
  // reach onMouseUp (bound only to the canvas), leaving draggingRef stuck.
  useEffect(() => {
    const handler = () => { draggingRef.current = false }
    window.addEventListener('mouseup', handler)
    return () => window.removeEventListener('mouseup', handler)
  }, [])

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
      // Let the completions popup scroll its own list — don't also scroll
      // the editor viewport underneath it.
      if ((e.target as HTMLElement | null)?.closest('.gpu-completions-popup')) return
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
      // Convert pixel delta to lines using a fixed "lines per wheel notch"
      // rate (independent of font size/cellHeight, which previously made a
      // single notch jump 5-6 lines). An accumulator carries fractional
      // remainders so small touchpad deltas still scroll smoothly. Each
      // event's contribution to the accumulator is itself capped to one
      // notch's worth of lines so devices that report oversized deltaY
      // (fast mice, trackpad momentum flings) can't dump dozens of lines in
      // a single frame. Capping the contribution (rather than the resulting
      // dLines) keeps the accumulator bounded — otherwise sustained scrolling
      // in one direction builds up unbounded "debt" that has to be paid off
      // before a reversal (scroll up) takes effect, causing visible drift.
      const wheelLines = Math.max(-LINES_PER_WHEEL_NOTCH, Math.min(LINES_PER_WHEEL_NOTCH, (e.deltaY / 100) * LINES_PER_WHEEL_NOTCH))
      wheelAccumRef.current += wheelLines
      const dLines = Math.trunc(wheelAccumRef.current)
      wheelAccumRef.current -= dLines
      const dCols = wordWrapRef.current ? 0 : Math.round(e.deltaX / renderer.cellWidth)
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
    selectAll: () => { void selectAll() },
    openFind,
    goToLine: (line: number) => {
      void setCursorTo(Math.max(0, line - 1), 0, false).then(() => {
        textareaRef.current?.focus()
      })
    },
    expandSmartSelect: () => { void expandSmartSelect() },
    shrinkSmartSelect,
    moveLineUp: () => { void moveLineUp() },
    moveLineDown: () => { void moveLineDown() },
    copyLineUp: () => { void copyLineUp() },
    copyLineDown: () => { void copyLineDown() },
  }), [save, undo, redo, selectAll, openFind, setCursorTo, expandSmartSelect, shrinkSmartSelect, moveLineUp, moveLineDown, copyLineUp, copyLineDown])

  return (
    <div className="h-full flex flex-col bg-[var(--app-bg)] overflow-hidden">
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
          onMouseLeave={onMouseLeave}
          onDoubleClick={onDoubleClick}
          style={{ display: 'block', cursor: 'text' }}
        />
        {gutterOverlay.rows.length > 0 && (
          <div
            className="gpu-gutter-overlay"
            style={{
              width: gutterOverlay.gutterWidth,
              '--gpu-gutter-color': (colors ?? DEFAULT_GPU_COLORS).gutter,
              '--gpu-gutter-active-color': (colors ?? DEFAULT_GPU_COLORS).gutterActive,
              '--gpu-error-color': (colors ?? DEFAULT_GPU_COLORS).errorLine,
            } as React.CSSProperties}
          >
            {gutterOverlay.rows.map(row => (
              <div key={row.ln} className="gpu-gutter-row" style={{ top: row.y, width: gutterOverlay.gutterWidth, height: gutterOverlay.ch }}>
                <button
                  type="button"
                  className={`gpu-pin-dot${row.pinned ? ' pinned' : ''}`}
                  style={{ left: pinDotX(gutterOverlay.gutterWidth, gutterOverlay.cw), width: gutterOverlay.cw, height: gutterOverlay.ch }}
                  onMouseDown={e => { e.preventDefault(); e.stopPropagation() }}
                  onClick={() => togglePin(row.ln)}
                  title={row.pinned ? 'Remove mark' : 'Mark line'}
                >
                  <span className="dot" />
                </button>
                {row.foldable && (
                  <button
                    type="button"
                    className={`gpu-fold-btn${row.current ? ' current' : ''}`}
                    style={{ left: foldGlyphX(gutterOverlay.gutterWidth, gutterOverlay.cw), width: gutterOverlay.cw, height: gutterOverlay.ch }}
                    onMouseDown={e => { e.preventDefault(); e.stopPropagation() }}
                    onClick={() => toggleFold(row.ln)}
                    title={row.folded ? 'Expand' : 'Collapse'}
                  >
                    {row.folded
                      ? <ChevronRight size={Math.max(18, Math.round(gutterOverlay.cw * 2.6))} strokeWidth={3} />
                      : <ChevronDown size={Math.max(18, Math.round(gutterOverlay.cw * 2.6))} strokeWidth={3} />}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {minimap && (
          <canvas
            ref={minimapCanvasRef}
            onMouseDown={onMinimapMouseDown}
            onMouseMove={onMinimapMouseMove}
            onMouseUp={onMinimapMouseUp}
            onMouseLeave={onMinimapMouseUp}
            style={{ position: 'absolute', top: 0, right: 0, width: `${MINIMAP_WIDTH}px`, height: '100%', cursor: 'pointer', borderLeft: '1px solid var(--border-color)' }}
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
            above={completionPos.above}
            maxHeight={completionPos.maxHeight}
            onSelect={setCompletionIndex}
            onAccept={i => { completionIndexRef.current = i; void acceptCompletion() }}
          />
        )}
        {hoverTooltip && (
          <div
            className="absolute z-30 max-w-[420px] rounded border border-[var(--border-color)] bg-[var(--info-bar-bg)] px-3 py-2 font-mono text-[12px] shadow-lg pointer-events-none"
            style={{ left: hoverTooltip.x, top: hoverTooltip.y }}
          >
            {hoverTooltip.items.map((item, i) => (
              <div key={i} className={i > 0 ? 'mt-2 pt-2 border-t border-[var(--border-color)]' : ''}>
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span
                    className="font-semibold text-[11px] uppercase"
                    style={{ color: item.sev === 0 ? (colors ?? DEFAULT_GPU_COLORS).errorLine : item.sev === 1 ? (colors ?? DEFAULT_GPU_COLORS).warningLine : '#3794ff' }}
                  >
                    {item.sev === 0 ? 'Error' : item.sev === 1 ? 'Warning' : 'Info'}
                  </span>
                  {item.code && (
                    <span className="text-[var(--info-bar-color)] text-[11px]">({item.code})</span>
                  )}
                </div>
                <div className="text-[var(--info-bar-hover-color)] whitespace-pre-wrap break-words">{item.msg}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
})

export default GpuEditor
