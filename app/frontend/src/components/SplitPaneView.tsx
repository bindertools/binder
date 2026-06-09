import React, { useRef, useCallback } from 'react'
import { PaneNode, LeafPane, SplitNode, updateRatioInTree } from '../paneModel'
import PaneTabBar from './PaneTabBar'
import { Tab } from '../types'

const DIVIDER_PX = 4

interface Props {
  node:            PaneNode
  focusedPaneId:   string
  allTabs:         Tab[]
  isOnlyPane:      boolean
  windowControls?: React.ReactNode
  onFocus:         (paneId: string) => void
  onClosePane:     (paneId: string) => void
  onRatioChange:   (splitId: string, ratio: number) => void
  onSelectTab:     (paneId: string, tabId: string) => void
  onCloseTab:      (tabId: string) => void
  onNewTerminal:   (paneId: string) => void
  onRename:        (tabId: string, title: string) => void
  onSetColor:      (tabId: string, color: string | null) => void
  onDuplicate:     (tabId: string) => void
  onDropTab:       (tabId: string, toPaneId: string) => void
  renderContent:   (pane: LeafPane) => React.ReactNode
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
  node, focusedPaneId, allTabs, isOnlyPane, windowControls,
  onFocus, onClosePane, onRatioChange,
  onSelectTab, onCloseTab, onNewTerminal,
  onRename, onSetColor, onDuplicate, onDropTab,
  renderContent,
}: Props) {

  if (node.type === 'split') {
    const isH = node.direction === 'h'
    const firstSize  = `calc(${node.ratio * 100}% - ${DIVIDER_PX / 2}px)`
    const secondSize = `calc(${(1 - node.ratio) * 100}% - ${DIVIDER_PX / 2}px)`

    const shared = {
      focusedPaneId, allTabs, isOnlyPane: false,
      onFocus, onClosePane, onRatioChange,
      onSelectTab, onCloseTab, onNewTerminal,
      onRename, onSetColor, onDuplicate, onDropTab,
      renderContent,
    }

    // Window controls always stay at top-right: top child for vertical splits, right child for horizontal
    return (
      <div className={`flex ${isH ? 'flex-row' : 'flex-col'} w-full h-full overflow-hidden`}>
        <div style={{ [isH ? 'width' : 'height']: firstSize }} className="overflow-hidden flex flex-col">
          <SplitPaneView {...shared} node={node.first} windowControls={isH ? undefined : windowControls} />
        </div>
        <SplitHandle node={node} onRatioChange={onRatioChange} />
        <div style={{ [isH ? 'width' : 'height']: secondSize }} className="overflow-hidden flex flex-col">
          <SplitPaneView {...shared} node={node.second} windowControls={isH ? windowControls : undefined} />
        </div>
      </div>
    )
  }

  // ── Leaf pane ──────────────────────────────────────────────────────────────
  const pane = node as LeafPane
  const paneTabs = pane.tabIds.map(id => allTabs.find(t => t.id === id)).filter((t): t is Tab => t !== undefined)
  const focused = pane.id === focusedPaneId

  return (
    <div
      className={`flex flex-col w-full h-full overflow-hidden${focused && !isOnlyPane ? ' pane--focused' : ''}`}
      onMouseDown={() => onFocus(pane.id)}
    >
      <PaneTabBar
        paneId={pane.id}
        tabs={paneTabs}
        activeId={pane.activeTabId}
        canClosePane={!isOnlyPane}
        windowControls={windowControls}
        onSelect={tabId => onSelectTab(pane.id, tabId)}
        onClose={tabId => onCloseTab(tabId)}
        onNewTerminal={() => onNewTerminal(pane.id)}
        onClosePane={() => onClosePane(pane.id)}
        onRename={onRename}
        onSetColor={onSetColor}
        onDuplicate={onDuplicate}
        onDrop={tabId => onDropTab(tabId, pane.id)}
      />
      <div className="flex-1 relative overflow-hidden">
        {renderContent(pane)}
      </div>
    </div>
  )
}
