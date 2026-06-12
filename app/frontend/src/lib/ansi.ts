import type { CSSProperties } from 'react'

// Minimal ANSI SGR (color/style) parser for rendering command output inside
// React command blocks. Cursor-movement, clear-screen, and other non-SGR CSI/OSC
// sequences are stripped rather than interpreted.

export interface AnsiSegment {
  text: string
  fg?: string
  bg?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
}

interface AnsiState {
  fg?: string
  bg?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
}

// Roughly iOS/macOS-system-color flavoured 16-color palette so ANSI output
// matches the app's existing semantic colors (errors red, success green, etc).
const ANSI_16 = [
  '#000000', '#FF453A', '#30D158', '#FF9F0A',
  '#0A84FF', '#BF5AF2', '#5AC8FA', '#d4d4d4',
  '#5c5c5c', '#FF6961', '#32D74B', '#FFD60A',
  '#409CFF', '#DA8FFF', '#70D7FF', '#ffffff',
]

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')
}

function ansi256ToHex(n: number): string {
  if (n < 16) return ANSI_16[n]
  if (n < 232) {
    const i = n - 16
    const levels = [0, 95, 135, 175, 215, 255]
    return rgbToHex(levels[Math.floor(i / 36)], levels[Math.floor((i % 36) / 6)], levels[i % 6])
  }
  const gray = 8 + (n - 232) * 10
  return rgbToHex(gray, gray, gray)
}

function applySgr(params: string, state: AnsiState): void {
  const nums = params.length ? params.split(';').map(p => (p === '' ? 0 : parseInt(p, 10))) : [0]
  for (let i = 0; i < nums.length; i++) {
    const code = nums[i]
    if (code === 0) {
      state.fg = undefined; state.bg = undefined
      state.bold = false; state.dim = false; state.italic = false; state.underline = false
    } else if (code === 1) state.bold = true
    else if (code === 2) state.dim = true
    else if (code === 3) state.italic = true
    else if (code === 4) state.underline = true
    else if (code === 22) { state.bold = false; state.dim = false }
    else if (code === 23) state.italic = false
    else if (code === 24) state.underline = false
    else if (code >= 30 && code <= 37) state.fg = ANSI_16[code - 30]
    else if (code === 38) {
      if (nums[i + 1] === 5) { state.fg = ansi256ToHex(nums[i + 2]); i += 2 }
      else if (nums[i + 1] === 2) { state.fg = `rgb(${nums[i + 2]},${nums[i + 3]},${nums[i + 4]})`; i += 4 }
    }
    else if (code === 39) state.fg = undefined
    else if (code >= 40 && code <= 47) state.bg = ANSI_16[code - 40]
    else if (code === 48) {
      if (nums[i + 1] === 5) { state.bg = ansi256ToHex(nums[i + 2]); i += 2 }
      else if (nums[i + 1] === 2) { state.bg = `rgb(${nums[i + 2]},${nums[i + 3]},${nums[i + 4]})`; i += 4 }
    }
    else if (code === 49) state.bg = undefined
    else if (code >= 90 && code <= 97) state.fg = ANSI_16[8 + (code - 90)]
    else if (code >= 100 && code <= 107) state.bg = ANSI_16[8 + (code - 100)]
  }
}

// Parses raw ANSI text into lines of styled segments. A lone `\r` (no `\n`)
// resets the current line, matching the "redraw in place" behavior used by
// progress bars/spinners — only the final state of the line is kept.
export function ansiToLines(input: string): AnsiSegment[][] {
  const lines: AnsiSegment[][] = []
  let current: AnsiSegment[] = []
  const state: AnsiState = {}

  const pushText = (text: string) => {
    if (!text) return
    current.push({ text, ...state })
  }

  let i = 0
  while (i < input.length) {
    const ch = input[i]

    if (ch === '\x1b') {
      const next = input[i + 1]
      if (next === '[') {
        let j = i + 2
        while (j < input.length && !/[A-Za-z]/.test(input[j])) j++
        const params = input.slice(i + 2, j)
        const cmd = input[j]
        if (cmd === 'm') applySgr(params, state)
        i = j + 1
      } else if (next === ']') {
        // OSC sequence — skip to BEL or ESC \
        let j = i + 2
        while (j < input.length && input[j] !== '\x07' && !(input[j] === '\x1b' && input[j + 1] === '\\')) j++
        i = input[j] === '\x1b' ? j + 2 : j + 1
      } else {
        i += 2 // skip lone ESC + next char
      }
      continue
    }

    if (ch === '\r' && input[i + 1] === '\n') {
      lines.push(current)
      current = []
      i += 2
      continue
    }
    if (ch === '\n') {
      lines.push(current)
      current = []
      i += 1
      continue
    }
    if (ch === '\r') {
      current = []
      i += 1
      continue
    }

    let j = i
    while (j < input.length && input[j] !== '\x1b' && input[j] !== '\n' && input[j] !== '\r') j++
    pushText(input.slice(i, j))
    i = j
  }
  if (current.length) lines.push(current)
  return lines
}

export function ansiSegmentStyle(seg: AnsiSegment): CSSProperties {
  const style: CSSProperties = {}
  if (seg.fg) style.color = seg.fg
  if (seg.bg) style.backgroundColor = seg.bg
  if (seg.bold) style.fontWeight = 600
  if (seg.dim) style.opacity = 0.6
  if (seg.italic) style.fontStyle = 'italic'
  if (seg.underline) style.textDecoration = 'underline'
  return style
}
