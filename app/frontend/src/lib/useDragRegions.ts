// Detects elements marked with --wails-draggable:drag and reports their
// screen-coordinate bounding rects to the C++ host via window.setDragRects.
// Only active in WebView host mode; no-ops in Wails mode.
import { useEffect, useCallback } from 'react'
import { invoke, isWebViewHost } from './ipc'

export function useDragRegions() {
  const update = useCallback(() => {
    if (!isWebViewHost()) return

    // Find all elements with --wails-draggable: drag set via inline style
    const all = document.querySelectorAll<HTMLElement>('[style]')
    const rects: Array<{x: number, y: number, w: number, h: number}> = []

    for (const el of all) {
      const drag = el.style.getPropertyValue('--wails-draggable').trim()
      if (drag !== 'drag') continue

      // Walk up to find any ancestor marked no-drag, skip those
      const bounds = el.getBoundingClientRect()
      if (bounds.width === 0 || bounds.height === 0) continue

      // Convert from CSS pixels (document coords) to screen coords.
      // window.screenX/Y is the WebView widget's screen position in WebView2.
      rects.push({
        x: Math.round(bounds.left + window.screenX),
        y: Math.round(bounds.top  + window.screenY),
        w: Math.round(bounds.width),
        h: Math.round(bounds.height),
      })
    }

    invoke('window.setDragRects', { rects }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!isWebViewHost()) return

    update()

    window.addEventListener('resize', update)
    // Also update after any layout change via ResizeObserver on body
    const ro = new ResizeObserver(update)
    ro.observe(document.body)

    return () => {
      window.removeEventListener('resize', update)
      ro.disconnect()
    }
  }, [update])
}
