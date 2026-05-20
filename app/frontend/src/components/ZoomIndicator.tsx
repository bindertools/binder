import React, { useEffect, useRef, useState } from 'react'
import './ZoomIndicator.scss'

interface Props { enabled: boolean; defaultZoom?: number; onZoomChange?: (level: number) => void }

const HOLD_MS = 5000

// Chrome / WebView2 zoom steps (matches the built-in step list exactly).
const STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0, 4.0, 5.0]

/** Return the index of the step closest to the given zoom value. */
function nearestStepIdx(zoom: number): number {
  let best = 0
  let bestDiff = Math.abs(STEPS[0] - zoom)
  for (let i = 1; i < STEPS.length; i++) {
    const diff = Math.abs(STEPS[i] - zoom)
    if (diff < bestDiff) { bestDiff = diff; best = i }
  }
  return best
}

export default function ZoomIndicator({ enabled, defaultZoom = 1, onZoomChange }: Props) {
  const [visible, setVisible] = useState(false)
  const [level,   setLevel]   = useState(defaultZoom)

  const stepIdx      = useRef(nearestStepIdx(defaultZoom))
  const defaultIdx   = useRef(nearestStepIdx(defaultZoom))
  const timer        = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Gate Ctrl+Scroll to one zoom step per 120 ms (mirrors Chrome's rate-limiting).
  const lastScroll   = useRef(0)
  // Track Ctrl key state manually — WebView2 can strip e.ctrlKey from wheel events.
  const ctrlHeld     = useRef(false)

  // Keep refs in sync when defaultZoom changes (e.g. config reload).
  useEffect(() => {
    const idx = nearestStepIdx(defaultZoom)
    stepIdx.current   = idx
    defaultIdx.current = idx
    setLevel(defaultZoom)
  }, [defaultZoom])

  useEffect(() => {
    if (!enabled) {
      setVisible(false)
      if (timer.current) clearTimeout(timer.current)
      return
    }

    const show = (newLevel: number) => {
      setLevel(newLevel)
      onZoomChange?.(newLevel)
      setVisible(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setVisible(false), HOLD_MS)
    }

    const zoomIn    = () => { stepIdx.current = Math.min(stepIdx.current + 1, STEPS.length - 1); return STEPS[stepIdx.current] }
    const zoomOut   = () => { stepIdx.current = Math.max(stepIdx.current - 1, 0);                 return STEPS[stepIdx.current] }
    // Ctrl+0 resets to whatever default_zoom is set to, not hardcoded 1.0.
    const zoomReset = () => { stepIdx.current = defaultIdx.current;                                return STEPS[defaultIdx.current] }

    const onWheel = (e: WheelEvent) => {
      // Accept either the event's own ctrlKey flag OR our manually tracked state.
      if (!e.ctrlKey && !ctrlHeld.current) return
      const now = Date.now()
      if (now - lastScroll.current < 120) return   // one step per tick
      lastScroll.current = now
      show(e.deltaY < 0 ? zoomIn() : zoomOut())
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Control') { ctrlHeld.current = true; return }
      if (!e.ctrlKey && !ctrlHeld.current) return
      if (e.key === '=' || e.key === '+') show(zoomIn())
      else if (e.key === '-')             show(zoomOut())
      else if (e.key === '0')             show(zoomReset())
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control') ctrlHeld.current = false
    }

    // Use capture phase so we see the event before any child handler can stop it.
    window.addEventListener('wheel',   onWheel,   { passive: true, capture: true })
    window.addEventListener('keydown', onKeyDown, { capture: true })
    window.addEventListener('keyup',   onKeyUp,   { capture: true })
    return () => {
      window.removeEventListener('wheel',   onWheel,   { capture: true })
      window.removeEventListener('keydown', onKeyDown, { capture: true })
      window.removeEventListener('keyup',   onKeyUp,   { capture: true })
      if (timer.current) clearTimeout(timer.current)
    }
  }, [enabled])

  if (!enabled || !visible) return null

  return (
    <div className="zoom-indicator">
      {level === 1.0 ? '1.0' : level % 1 === 0 ? level.toFixed(1) : (Math.round(level * 100) / 100).toString()}×
    </div>
  )
}
