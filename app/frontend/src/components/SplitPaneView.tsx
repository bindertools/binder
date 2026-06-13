import React, { useRef, useCallback } from 'react'
import { PaneNode, LeafPane, SplitNode } from '../paneModel'

const DIVIDER_PX = 4

interface Props {
  node:          PaneNode
  focusedPaneId: string
  isOnlyPane:    boolean
  onFocus:       (paneId: string) => void
  onClosePane:   (paneId: string) => void
  onRatioChange: (splitId: string, ratio: number) => void
  renderContent: (pane: LeafPane) => React.ReactNode
}

// ── SplitHandle ───────────────────────────────────────────────────────────────

function SplitHandle({
  node,
  onRatioChange,
}: {
  node: SplitNode
  onRatioChange: (splitId: string, ratio: number) => void
}) {
  const dragging = useRef(false)
  const containerRef = useRef<HTMLElement | null>(null)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    const el = (e.currentTarget as HTMLElement).parentElement
    containerRef.current = el

    const onMove = (mv: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const ratio = node.direction === 'h'
        ? (mv.clientX - rect.left) / rect.width
        : (mv.clientY - rect.top) / rect.height
      onRatioChange(node.id, Math.max(0.1, Math.min(0.9, ratio)))
    }
    const onUp = () => {
      dragging.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [node.direction, node.id, onRatioChange])

  const isH = node.direction === 'h'
  return (
    <div
      className={[
        isH ? 'cursor-col-resize' : 'cursor-row-resize',
        'shrink-0 z-10 transition-[background] duration-[150ms]',
        'bg-[var(--border-color)] hover:bg-[rgba(10,132,255,0.45)] active:bg-[rgba(10,132,255,0.45)]',
      ].join(' ')}
      style={{ [isH ? 'width' : 'height']: DIVIDER_PX }}
      onMouseDown={onMouseDown}
    />
  )
}

// ── SplitPaneView ─────────────────────────────────────────────────────────────

export default function SplitPaneView({
  node, focusedPaneId, isOnlyPane,
  onFocus, onClosePane, onRatioChange, renderContent,
}: Props) {

  if (node.type === 'split') {
    const isH = node.direction === 'h'
    const firstSize  = `calc(${node.ratio * 100}% - ${DIVIDER_PX / 2}px)`
    const secondSize = `calc(${(1 - node.ratio) * 100}% - ${DIVIDER_PX / 2}px)`

    const shared = {
      focusedPaneId, isOnlyPane: false,
      onFocus, onClosePane, onRatioChange, renderContent,
    }

    return (
      <div className={`flex ${isH ? 'flex-row' : 'flex-col'} w-full h-full overflow-hidden`}>
        <div style={{ [isH ? 'width' : 'height']: firstSize }} className="overflow-hidden flex flex-col">
          <SplitPaneView {...shared} node={node.first} />
        </div>
        <SplitHandle node={node} onRatioChange={onRatioChange} />
        <div style={{ [isH ? 'width' : 'height']: secondSize }} className="overflow-hidden flex flex-col">
          <SplitPaneView {...shared} node={node.second} />
        </div>
      </div>
    )
  }

  // ── Leaf pane ──────────────────────────────────────────────────────────────
  const pane = node
  const focused = pane.id === focusedPaneId

  return (
    <div
      className={`relative flex flex-col w-full h-full overflow-hidden${focused && !isOnlyPane ? ' pane--focused' : ''}`}
      onMouseDown={() => onFocus(pane.id)}
    >
      <div className="flex-1 relative overflow-hidden">
        {renderContent(pane)}
      </div>

      {!isOnlyPane && (
        <button
          className="absolute bottom-3 right-3 z-[200] flex items-center justify-center w-[22px] h-[22px] rounded-full bg-[var(--app-bg)] border border-[var(--border-color)] text-[var(--tab-color)] opacity-30 hover:opacity-100 hover:bg-surface-overlay hover:text-[var(--tab-color-hover)] hover:border-[var(--tab-color)] transition-[opacity,background,color,border-color] duration-[120ms] cursor-pointer"
          onClick={e => { e.stopPropagation(); onClosePane(pane.id) }}
          title="Close panel"
        >
          <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
            <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
      )}
    </div>
  )
}
