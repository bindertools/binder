// Guardrail: scans src/**/*.{ts,tsx} (excluding wailsjs/) for emoji/symbol
// glyphs and em-dashes (U+2014) outside of comments. Run on demand with
// `npm run check:ui-text` — not wired into build/lint.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(import.meta.dirname, '..', 'src')

const EM_DASH = /—/
const SYMBOL_GLYPHS = /[\u{2190}-\u{21FF}\u{2300}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F000}-\u{1FFFF}\u{FE0F}]/u

// Terminal and Code Editor surfaces are out of scope for the SVG-icon /
// no-em-dash UI rules (separate design language, e.g. shortcut glyphs and
// block-output markers).
const EXCLUDED_FILES = new Set([
  join('components', 'Terminal.tsx'),
  join('components', 'TerminalBlockList.tsx'),
  join('components', 'GpuEditor.tsx'),
  join('fullscreen', 'MenuBar.tsx'),
])

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'wailsjs') continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) yield* walk(full)
    else if (/\.(ts|tsx)$/.test(entry)) yield full
  }
}

// Strips `//` and `/* ... */` comments (including multi-line blocks) from a
// line, tracking minimal string state so `//` inside strings isn't treated
// as a comment. Heuristic — good enough for a manual guardrail pass.
function stripComment(line, state) {
  if (state.inBlock) {
    const end = line.indexOf('*/')
    if (end === -1) return ''
    state.inBlock = false
    return stripComment(line.slice(end + 2), state)
  }
  let inStr = null
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inStr) {
      if (c === '\\') { i++; continue }
      if (c === inStr) inStr = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue }
    if (c === '/' && line[i + 1] === '/') return line.slice(0, i)
    if (c === '/' && line[i + 1] === '*') {
      const end = line.indexOf('*/', i + 2)
      if (end === -1) { state.inBlock = true; return line.slice(0, i) }
      return line.slice(0, i) + stripComment(line.slice(end + 2), state)
    }
  }
  return line
}

let issues = 0

for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file)
  if (EXCLUDED_FILES.has(rel)) continue
  const lines = readFileSync(file, 'utf8').split('\n')
  const state = { inBlock: false }

  lines.forEach((rawLine, idx) => {
    const code = stripComment(rawLine, state)
    if (EM_DASH.test(code)) {
      issues++
      console.log(`${rel}:${idx + 1}: em-dash (U+2014) — ${code.trim()}`)
    }
    const glyphMatch = code.match(SYMBOL_GLYPHS)
    if (glyphMatch) {
      issues++
      console.log(`${rel}:${idx + 1}: symbol glyph "${glyphMatch[0]}" — ${code.trim()}`)
    }
  })
}

if (issues === 0) {
  console.log('No em-dashes or emoji/symbol glyphs found outside comments.')
  process.exit(0)
} else {
  console.log(`\n${issues} issue${issues !== 1 ? 's' : ''} found.`)
  process.exit(1)
}
