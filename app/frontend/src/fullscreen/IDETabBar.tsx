import React, { useState, useCallback, useRef, useEffect } from 'react'
import ContextMenu, { ContextMenuItem } from './ContextMenu'
import FileIcon from './FileIcon'

export interface OpenFile {
  path: string
  name: string
  content: string
  dirty: boolean
  language: string
  pinned: boolean        // true once edited — stays in tab bar after navigating away
  panel: 'left' | 'right'
}

interface Props {
  files: OpenFile[]                  // full pool; we filter by panel here
  panel: 'left' | 'right'
  activeFile: string | null
  selectedPaths: Set<string>
  onActivate:    (path: string) => void
  onClose:       (paths: string[]) => void
  onMoveToPanel: (paths: string[], target: 'left' | 'right') => void
  onSelectTab:   (path: string, e: React.MouseEvent) => void
  onDragStart:   (e: React.DragEvent, path: string) => void
  onDrop:        (e: React.DragEvent, panel: 'left' | 'right') => void
}

const SCROLL_STEP = 160

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase() : ''
}

function ChevronIcon({ direction }: { direction: 'left' | 'right' }) {
  const d = direction === 'left' ? 'M8 2.5 3.5 7 8 11.5' : 'M4 2.5 8.5 7 4 11.5'
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M2 2 9 9M9 2 2 9" />
    </svg>
  )
}

export default function IDETabBar({
  files, panel, activeFile, selectedPaths,
  onActivate, onClose, onMoveToPanel, onSelectTab, onDragStart, onDrop,
}: Props) {
  const [menu, setMenu]         = useState<{ x: number; y: number; path: string } | null>(null)
  const [dropOver, setDropOver] = useState(false)
  const [canScrollLeft, setCanScrollLeft]   = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // A tab is visible if it belongs to this panel AND (has been edited OR is currently active)
  const visible = files.filter(f => f.panel === panel && (f.pinned || f.path === activeFile))

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 0)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
  }, [])

  useEffect(() => {
    updateScrollState()
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(updateScrollState)
    ro.observe(el)
    return () => ro.disconnect()
  }, [updateScrollState, visible.length])

  // Keep the active tab in view when it changes (e.g. activated via Quick Open)
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !activeFile) return
    const tab = el.querySelector<HTMLElement>(`[data-tab-path="${CSS.escape(activeFile)}"]`)
    tab?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeFile])

  const scrollBy = (delta: number) => {
    scrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' })
  }

  const openMenu = useCallback((e: React.MouseEvent, path: string) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, path })
  }, [])

  const buildMenu = (path: string): ContextMenuItem[] => {
    const idx        = visible.findIndex(f => f.path === path)
    const isSelected = selectedPaths.has(path)
    const selCount   = selectedPaths.size
    const target     = panel === 'left' ? 'right' : 'left'
    const toClose    = selCount > 1 && isSelected ? [...selectedPaths] : [path]

    const items: ContextMenuItem[] = [
      {
        label: selCount > 1 && isSelected ? `Close ${selCount} Selected Tabs` : 'Close Tab',
        action: () => onClose(toClose),
      },
      { divider: true },
      {
        label: 'Close All Tabs',
        action: () => onClose(visible.map(f => f.path)),
      },
      {
        label: 'Close Other Tabs',
        action: () => onClose(visible.filter(f => f.path !== path).map(f => f.path)),
      },
      {
        label: 'Close Tabs to the Left',
        action: () => onClose(visible.slice(0, idx).map(f => f.path)),
      },
      {
        label: 'Close Tabs to the Right',
        action: () => onClose(visible.slice(idx + 1).map(f => f.path)),
      },
      { divider: true },
      {
        label: panel === 'left' ? 'Open in Right Panel' : 'Open in Left Panel',
        action: () => onMoveToPanel(toClose, target),
      },
    ]
    return items
  }

  return (
    <div
      className={`ide-tabs${dropOver ? ' ide-tabs--drop-target' : ''}`}
      onDragOver={e => { e.preventDefault(); setDropOver(true) }}
      onDragLeave={e => {
        // only clear if leaving the tab bar itself, not a child
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropOver(false)
      }}
      onDrop={e => { setDropOver(false); onDrop(e, panel) }}
    >
      <div className="ide-tabs__nav">
        <button
          className="ide-tabs__arrow"
          disabled={!canScrollLeft}
          onClick={() => scrollBy(-SCROLL_STEP)}
          title="Scroll tabs left"
        >
          <ChevronIcon direction="left" />
        </button>
        <button
          className="ide-tabs__arrow"
          disabled={!canScrollRight}
          onClick={() => scrollBy(SCROLL_STEP)}
          title="Scroll tabs right"
        >
          <ChevronIcon direction="right" />
        </button>
      </div>

      <div className="ide-tabs__scroll" ref={scrollRef} onScroll={updateScrollState}>
        {visible.map(f => {
          const isActive   = f.path === activeFile
          const isSelected = selectedPaths.has(f.path)
          const isPreview  = !f.pinned

          return (
            <div
              key={f.path}
              data-tab-path={f.path}
              draggable
              className={[
                'ide-tab',
                isActive   ? 'ide-tab--active'   : '',
                isSelected ? 'ide-tab--selected' : '',
                isPreview  ? 'ide-tab--preview'  : '',
              ].filter(Boolean).join(' ')}
              title={f.path}
              onDragStart={e => onDragStart(e, f.path)}
              onClick={e => {
                if (e.ctrlKey || e.metaKey || e.shiftKey) {
                  onSelectTab(f.path, e)
                } else {
                  onActivate(f.path)
                }
              }}
              onContextMenu={e => openMenu(e, f.path)}
            >
              {isActive && (
                <button
                  className="ide-tab__close ide-tab__close--leading"
                  onMouseDown={e => { e.stopPropagation(); onClose([f.path]) }}
                  title="Close"
                >
                  <CloseIcon />
                </button>
              )}
              <span className="ide-tab__icon">
                <FileIcon name={f.name} ext={extOf(f.name)} isDir={false} />
              </span>
              <span className="ide-tab__name">{f.name}</span>
              {f.dirty && <span className="ide-tab__dot" />}
              {!isActive && (
                <button
                  className="ide-tab__close"
                  onMouseDown={e => { e.stopPropagation(); onClose([f.path]) }}
                  title="Close"
                >
                  <CloseIcon />
                </button>
              )}
            </div>
          )
        })}

        {visible.length === 0 && (
          <div className="ide-tabs__empty">
            {panel === 'right' ? 'Drag a tab here to split' : 'No files open'}
          </div>
        )}
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={buildMenu(menu.path)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}
