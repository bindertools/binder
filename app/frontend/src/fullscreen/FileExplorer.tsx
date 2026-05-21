import React, { useState, useCallback, useRef } from 'react'
import { ExplorerCreateDir, ExplorerCreateFile, ExplorerDelete, ExplorerMove, ExplorerRename } from '../../wailsjs/go/main/App'
import ContextMenu, { ContextMenuItem } from './ContextMenu'
import FileIcon from './FileIcon'

export interface FileNode {
  name: string
  path: string
  isDir: boolean
  ext: string
  children?: FileNode[]
}

interface Props {
  root: FileNode | null
  selectedPath: string
  onSelect: (node: FileNode) => void
  onRefresh: () => void
}

interface CtxState {
  x: number
  y: number
  node: FileNode
}

const IconNewFile  = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 2H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6"/><path d="M9 2v4h4"/><line x1="8" y1="9" x2="8" y2="13"/><line x1="6" y1="11" x2="10" y2="11"/></svg>
const IconNewFolder = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 5a1 1 0 0 1 1-1h3.586a1 1 0 0 1 .707.293L8.414 5.4A1 1 0 0 0 9.121 5.7H13a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5z"/><line x1="8" y1="8" x2="8" y2="12"/><line x1="6" y1="10" x2="10" y2="10"/></svg>
const IconRename    = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11.5 2.5a2.121 2.121 0 0 1 3 3L5 15H2v-3L11.5 2.5z"/></svg>
const IconCopyPath  = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="5" width="8" height="9" rx="1"/><path d="M11 5V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h1"/></svg>
const IconDelete    = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="4,6 12,6"/><path d="M6 6V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2"/><path d="M5 6l.6 7a1 1 0 0 0 1 .9h2.8a1 1 0 0 0 1-.9L11 6"/></svg>

export default function FileExplorer({ root, selectedPath, onSelect, onRefresh }: Props) {
  const [expanded,   setExpanded]   = useState<Set<string>>(new Set())
  const [ctx,        setCtx]        = useState<CtxState | null>(null)
  const [renaming,   setRenaming]   = useState<string | null>(null)
  const [renameVal,  setRenameVal]  = useState('')
  const [dragOver,   setDragOver]   = useState<string | null>(null)
  const dragSrc = useRef<string | null>(null)

  const toggle = useCallback((path: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(path) ? next.delete(path) : next.add(path)
      return next
    })
  }, [])

  const openCtx = useCallback((e: React.MouseEvent, node: FileNode) => {
    e.preventDefault()
    e.stopPropagation()
    setCtx({ x: e.clientX, y: e.clientY, node })
  }, [])

  const startRename = useCallback((node: FileNode) => {
    setRenaming(node.path)
    setRenameVal(node.name)
  }, [])

  const commitRename = useCallback(async (node: FileNode) => {
    if (!renameVal.trim() || renameVal === node.name) { setRenaming(null); return }
    const dir = node.path.substring(0, node.path.lastIndexOf('/'))
    await ExplorerRename(node.path, `${dir}/${renameVal.trim()}`)
    setRenaming(null)
    onRefresh()
  }, [renameVal, onRefresh])

  const handleDelete = useCallback(async (node: FileNode) => {
    if (!confirm(`Delete "${node.name}"?`)) return
    await ExplorerDelete(node.path)
    onRefresh()
  }, [onRefresh])

  const handleNewFile = useCallback(async (node: FileNode) => {
    const dir = node.isDir ? node.path : node.path.substring(0, node.path.lastIndexOf('/'))
    const name = prompt('File name:')
    if (!name?.trim()) return
    await ExplorerCreateFile(`${dir}/${name.trim()}`)
    setExpanded(prev => new Set(prev).add(dir))
    onRefresh()
  }, [onRefresh])

  const handleNewFolder = useCallback(async (node: FileNode) => {
    const dir = node.isDir ? node.path : node.path.substring(0, node.path.lastIndexOf('/'))
    const name = prompt('Folder name:')
    if (!name?.trim()) return
    await ExplorerCreateDir(`${dir}/${name.trim()}`)
    setExpanded(prev => new Set(prev).add(dir))
    onRefresh()
  }, [onRefresh])

  const handleCopyPath = useCallback((node: FileNode) => {
    navigator.clipboard.writeText(node.path)
  }, [])

  const buildMenu = useCallback((node: FileNode): ContextMenuItem[] => [
    { label: 'New File',   icon: <IconNewFile />,   action: () => handleNewFile(node) },
    { label: 'New Folder', icon: <IconNewFolder />, action: () => handleNewFolder(node) },
    { divider: true },
    { label: 'Rename',     icon: <IconRename />,    action: () => startRename(node) },
    { label: 'Copy Path',  icon: <IconCopyPath />,  action: () => handleCopyPath(node) },
    { divider: true },
    { label: 'Delete',     icon: <IconDelete />,    danger: true, action: () => handleDelete(node) },
  ], [handleNewFile, handleNewFolder, startRename, handleCopyPath, handleDelete])

  // ── drag and drop ────────────────────────────────────────────────────────────
  const onDragStart = (e: React.DragEvent, node: FileNode) => {
    dragSrc.current = node.path
    e.dataTransfer.effectAllowed = 'move'
  }

  const onDragOver = (e: React.DragEvent, node: FileNode) => {
    if (!node.isDir || node.path === dragSrc.current) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOver(node.path)
  }

  const onDrop = async (e: React.DragEvent, node: FileNode) => {
    e.preventDefault()
    setDragOver(null)
    if (!dragSrc.current || !node.isDir || node.path === dragSrc.current) return
    const srcName = dragSrc.current.split('/').pop()!
    await ExplorerMove(dragSrc.current, `${node.path}/${srcName}`)
    dragSrc.current = null
    onRefresh()
  }

  const onDragEnd = () => { dragSrc.current = null; setDragOver(null) }

  // ── recursive tree node ──────────────────────────────────────────────────────
  function renderNode(node: FileNode, depth: number): React.ReactNode {
    const isOpen     = expanded.has(node.path)
    const isSelected = node.path === selectedPath
    const isDragTarget = dragOver === node.path
    const isRenamingThis = renaming === node.path

    return (
      <div key={node.path}>
        <div
          className={[
            'fe-node',
            isSelected  ? 'fe-node--selected'  : '',
            isDragTarget ? 'fe-node--dragover'  : '',
          ].join(' ')}
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
          onClick={() => {
            if (node.isDir) toggle(node.path)
            else onSelect(node)
          }}
          onContextMenu={e => openCtx(e, node)}
          draggable
          onDragStart={e => onDragStart(e, node)}
          onDragOver={e => onDragOver(e, node)}
          onDrop={e => onDrop(e, node)}
          onDragEnd={onDragEnd}
          onDragLeave={() => setDragOver(null)}
        >
          <span className="fe-node__chevron">
            {node.isDir ? (
              <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.1s' }}>
                <path d="M2 1l4 3-4 3V1z"/>
              </svg>
            ) : null}
          </span>
          <span className="fe-node__icon">
            <FileIcon name={node.name} ext={node.ext} isDir={node.isDir} isOpen={isOpen} />
          </span>

          {isRenamingThis ? (
            <input
              className="fe-node__rename"
              value={renameVal}
              autoFocus
              onChange={e => setRenameVal(e.target.value)}
              onBlur={() => commitRename(node)}
              onKeyDown={e => {
                if (e.key === 'Enter') commitRename(node)
                if (e.key === 'Escape') setRenaming(null)
                e.stopPropagation()
              }}
              onClick={e => e.stopPropagation()}
            />
          ) : (
            <span className="fe-node__name">{node.name}</span>
          )}
        </div>

        {node.isDir && isOpen && node.children?.map(child => renderNode(child, depth + 1))}
      </div>
    )
  }

  if (!root) {
    return <div className="fe-empty">No directory open</div>
  }

  return (
    <div className="fe-root">
      {/* Root label */}
      <div
        className="fe-header"
        onContextMenu={e => openCtx(e, root)}
      >
        <span className="fe-header__icon">
          <FileIcon name={root.name} ext="" isDir={true} isOpen={true} />
        </span>
        <span className="fe-header__name">{root.name.toUpperCase()}</span>
      </div>

      {/* Tree */}
      <div className="fe-tree">
        {root.children?.map(child => renderNode(child, 0))}
      </div>

      {/* Context menu */}
      {ctx && (
        <ContextMenu
          x={ctx.x}
          y={ctx.y}
          items={buildMenu(ctx.node)}
          onClose={() => setCtx(null)}
        />
      )}
    </div>
  )
}
