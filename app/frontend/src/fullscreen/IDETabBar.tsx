import React, { useState, useCallback } from 'react'
import ContextMenu, { ContextMenuItem } from './ContextMenu'

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

export default function IDETabBar({
  files, panel, activeFile, selectedPaths,
  onActivate, onClose, onMoveToPanel, onSelectTab, onDragStart, onDrop,
}: Props) {
  const [menu, setMenu]         = useState<{ x: number; y: number; path: string } | null>(null)
  const [dropOver, setDropOver] = useState(false)

  // A tab is visible if it belongs to this panel AND (has been edited OR is currently active)
  const visible = files.filter(f => f.panel === panel && (f.pinned || f.path === activeFile))

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
      {visible.map(f => {
        const isActive   = f.path === activeFile
        const isSelected = selectedPaths.has(f.path)
        const isPreview  = !f.pinned

        return (
          <div
            key={f.path}
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
            <span className="ide-tab__name">{f.name}</span>
            {f.dirty && <span className="ide-tab__dot" />}
            <button
              className="ide-tab__close"
              onMouseDown={e => { e.stopPropagation(); onClose([f.path]) }}
              title="Close"
            >x</button>
          </div>
        )
      })}

      {visible.length === 0 && (
        <div className="ide-tabs__empty">
          {panel === 'right' ? 'Drag a tab here to split' : 'No files open'}
        </div>
      )}

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
