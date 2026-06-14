import React from 'react'
import type { GpuEditorColors } from '../themes'
import GpuEditor from './GpuEditor'

interface Props {
  tabId:        string
  filePath:     string
  active:       boolean
  defaultZoom?: number
  gotoLine?:    number
  gpuColors?:   GpuEditorColors
  minimap?:     boolean
  diagnostics?: { line: number; sev: number }[]
}

export default function Editor({
  tabId: _tabId, filePath, active: _active, defaultZoom = 1, gotoLine, gpuColors, minimap, diagnostics,
}: Props) {
  const fontSize = Math.round(13 * defaultZoom)

  return <GpuEditor filePath={filePath} fontSize={fontSize} colors={gpuColors} minimap={minimap} gotoLine={gotoLine} diagnostics={diagnostics} />
}
