// Canvas2D minimap overlay for GpuEditor — a coarse color-block preview of
// the file, rendered separately from the WebGL2 text canvas since it doesn't
// need real glyphs.
import type { RGBA } from './gpuTextRenderer'

export interface MinimapLineData { text: string; spans: [number, number, number][] }

export const MINIMAP_WIDTH = 100
export const MINIMAP_CHAR_WIDTH = 2
export const MINIMAP_ROW_HEIGHT = 2
// Above this many lines, the minimap shows a scaled window around the
// viewport instead of the whole file (full-file mode gets sub-pixel rows).
export const MINIMAP_FULL_FILE_CAP = 5000

export interface MinimapGeometry {
  firstLine: number
  lastLine: number
  rowHeight: number
}

function rgbaCss(c: RGBA): string {
  return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${c.a})`
}

export function computeMinimapGeometry(
  lineCount: number, height: number, topLine: number, _visibleRows: number,
): MinimapGeometry {
  if (lineCount <= 0 || height <= 0) return { firstLine: 0, lastLine: -1, rowHeight: MINIMAP_ROW_HEIGHT }
  if (lineCount <= MINIMAP_FULL_FILE_CAP) {
    return { firstLine: 0, lastLine: lineCount - 1, rowHeight: Math.min(MINIMAP_ROW_HEIGHT, height / lineCount) }
  }
  const rowHeight = MINIMAP_ROW_HEIGHT
  const rowsShown = Math.max(1, Math.floor(height / rowHeight))
  const overscan = Math.floor(rowsShown / 2)
  let firstLine = Math.max(0, topLine - overscan)
  const lastLine = Math.min(lineCount - 1, firstLine + rowsShown - 1)
  firstLine = Math.max(0, lastLine - rowsShown + 1)
  return { firstLine, lastLine, rowHeight }
}

export function drawMinimap(
  ctx: CanvasRenderingContext2D,
  width: number, height: number,
  getLine: (ln: number) => MinimapLineData | undefined,
  styles: RGBA[], bg: RGBA,
  topLine: number, visibleRows: number, viewportColor: RGBA,
  geometry: MinimapGeometry,
  pinnedLines?: Set<number>, pinColor?: RGBA,
): void {
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = rgbaCss(bg)
  ctx.fillRect(0, 0, width, height)

  const { firstLine, lastLine, rowHeight } = geometry
  if (lastLine >= firstLine) {
    const maxChars = Math.ceil(width / MINIMAP_CHAR_WIDTH)
    const blockH = Math.max(rowHeight, 1)

    for (let ln = firstLine; ln <= lastLine; ln++) {
      const y = (ln - firstLine) * rowHeight
      if (y > height) break
      const data = getLine(ln)
      if (!data) continue
      const text = data.text
      const len = Math.min(text.length, maxChars)
      if (len === 0) continue
      const styleAt = new Uint8Array(len)
      for (const [s, e, style] of data.spans) {
        for (let i = Math.max(0, s); i < Math.min(len, e); i++) styleAt[i] = style
      }
      for (let i = 0; i < len; i++) {
        const ch = text[i]
        if (ch === ' ' || ch === '\t') continue
        ctx.fillStyle = rgbaCss(styles[styleAt[i]] ?? styles[0])
        ctx.fillRect(i * MINIMAP_CHAR_WIDTH, y, MINIMAP_CHAR_WIDTH, blockH)
      }
    }

    // Viewport indicator
    const vy = (topLine - firstLine) * rowHeight
    const vh = Math.max(2, visibleRows * rowHeight)
    ctx.fillStyle = rgbaCss(viewportColor)
    ctx.fillRect(0, vy, width, vh)

    // Pinned/marked lines — a solid bar across the full width, drawn last
    // so marks stay visible over the viewport indicator.
    if (pinnedLines && pinnedLines.size > 0 && pinColor) {
      ctx.fillStyle = rgbaCss(pinColor)
      for (const ln of pinnedLines) {
        if (ln < firstLine || ln > lastLine) continue
        const y = (ln - firstLine) * rowHeight
        ctx.fillRect(0, y, width, Math.max(2, rowHeight))
      }
    }
  }
}

// Convert a click/drag Y coordinate (CSS px, relative to the minimap canvas)
// into a source line number.
export function minimapLineAt(y: number, geometry: MinimapGeometry): number {
  const { firstLine, rowHeight } = geometry
  return Math.max(0, firstLine + Math.floor(y / rowHeight))
}
