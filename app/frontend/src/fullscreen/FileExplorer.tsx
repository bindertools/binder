import React, { useState, useCallback, useRef } from 'react'
import { ExplorerCreateDir, ExplorerCreateFile, ExplorerDelete, ExplorerMove, ExplorerRename, ExplorerReveal } from '../../wailsjs/go/main/App'
import ContextMenu, { ContextMenuItem } from './ContextMenu'
import DeleteConfirmDialog from './DeleteConfirmDialog'
import NewItemDialog from './NewItemDialog'
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

type CtxKind = 'file' | 'area'

interface CtxState {
  x: number
  y: number
  node: FileNode
  kind: CtxKind
}


export default function FileExplorer({ root, selectedPath, onSelect, onRefresh }: Props) {
  const [expanded,     setExpanded]     = useState<Set<string>>(new Set())
  const [ctx,          setCtx]          = useState<CtxState | null>(null)
  const [renaming,     setRenaming]     = useState<string | null>(null)
  const [renameVal,    setRenameVal]    = useState('')
  const [dragOver,     setDragOver]     = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<FileNode | null>(null)
  const [newItem,      setNewItem]      = useState<{ kind: 'file' | 'folder'; dir: string } | null>(null)
  const dragSrc = useRef<string | null>(null)

  const toggle = useCallback((path: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(path) ? next.delete(path) : next.add(path)
      return next
    })
  }, [])

  // Right-click on a file/folder node
  const openFileCtx = useCallback((e: React.MouseEvent, node: FileNode) => {
    e.preventDefault()
    e.stopPropagation()
    setCtx({ x: e.clientX, y: e.clientY, node, kind: 'file' })
  }, [])

  // Right-click on empty tree area or header
  const openAreaCtx = useCallback((e: React.MouseEvent, node: FileNode) => {
    e.preventDefault()
    setCtx({ x: e.clientX, y: e.clientY, node, kind: 'area' })
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

  // Opens the custom delete confirm dialog
  const handleDelete = useCallback((node: FileNode) => {
    setDeleteTarget(node)
  }, [])

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return
    await ExplorerDelete(deleteTarget.path)
    setDeleteTarget(null)
    onRefresh()
  }, [deleteTarget, onRefresh])

  const handleNewFile = useCallback((node: FileNode) => {
    const dir = node.isDir ? node.path : node.path.substring(0, node.path.lastIndexOf('/'))
    setNewItem({ kind: 'file', dir })
    setCtx(null)
  }, [])

  const handleNewFolder = useCallback((node: FileNode) => {
    const dir = node.isDir ? node.path : node.path.substring(0, node.path.lastIndexOf('/'))
    setNewItem({ kind: 'folder', dir })
    setCtx(null)
  }, [])

  const confirmNewItem = useCallback(async (filename: string) => {
    if (!newItem) return
    const fullPath = `${newItem.dir}/${filename}`
    if (newItem.kind === 'file') {
      await ExplorerCreateFile(fullPath)
    } else {
      await ExplorerCreateDir(fullPath)
    }
    setExpanded(prev => new Set(prev).add(newItem.dir))
    setNewItem(null)
    onRefresh()
  }, [newItem, onRefresh])

  const handleCopyPath = useCallback((node: FileNode) => {
    navigator.clipboard.writeText(node.path)
  }, [])

  const handleReveal = useCallback((node: FileNode) => {
    ExplorerReveal(node.path).catch(() => {})
  }, [])

  const collapseAll = useCallback(() => {
    setExpanded(new Set())
  }, [])

  // ── File-node context menu — no icons ──────────────────────────────────────
  const buildFileMenu = useCallback((node: FileNode): ContextMenuItem[] => [
    { label: 'New File',   action: () => handleNewFile(node) },
    { label: 'New Folder', action: () => handleNewFolder(node) },
    { divider: true },
    { label: 'Rename',     action: () => startRename(node) },
    { label: 'Copy Path',  action: () => handleCopyPath(node) },
    { divider: true },
    { label: 'Delete',     danger: true, action: () => handleDelete(node) },
  ], [handleNewFile, handleNewFolder, startRename, handleCopyPath, handleDelete])

  // ── Empty-area context menu — acts on root dir ─────────────────────────────
  const buildAreaMenu = useCallback((node: FileNode): ContextMenuItem[] => [
    { label: 'New File',         action: () => handleNewFile(node) },
    { label: 'New Folder',       action: () => handleNewFolder(node) },
    { divider: true },
    { label: 'Open in Explorer', action: () => handleReveal(node) },
    { label: 'Refresh',          action: onRefresh },
    { label: 'Collapse All',     action: collapseAll },
  ], [handleNewFile, handleNewFolder, handleReveal, onRefresh, collapseAll])

  // ── Drag and drop ─────────────────────────────────────────────────────────
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

  // ── Recursive tree node ───────────────────────────────────────────────────
  function renderNode(node: FileNode, depth: number): React.ReactNode {
    const isOpen        = expanded.has(node.path)
    const isSelected    = node.path === selectedPath
    const isDragTarget  = dragOver === node.path
    const isRenamingThis = renaming === node.path

    return (
      <div key={node.path}>
        <div
          className={[
            'fe-node',
            isSelected   ? 'fe-node--selected' : '',
            isDragTarget ? 'fe-node--dragover'  : '',
          ].join(' ')}
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
          onClick={() => {
            if (node.isDir) toggle(node.path)
            else onSelect(node)
          }}
          onContextMenu={e => openFileCtx(e, node)}
          draggable
          onDragStart={e => onDragStart(e, node)}
          onDragOver={e => onDragOver(e, node)}
          onDrop={e => onDrop(e, node)}
          onDragEnd={onDragEnd}
          onDragLeave={() => setDragOver(null)}
        >
          <span className="fe-node__chevron">
            {node.isDir ? (
              <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor"
                style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.1s' }}>
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

  const activeItems = ctx
    ? ctx.kind === 'area' ? buildAreaMenu(ctx.node) : buildFileMenu(ctx.node)
    : []

  return (
    <div className="fe-root">
      {/* Root label — area menu */}
      <div
        className="fe-header"
        onContextMenu={e => openAreaCtx(e, root)}
      >
        <span className="fe-header__icon">
          <FileIcon name={root.name} ext="" isDir={true} isOpen={true} />
        </span>
        <span className="fe-header__name">{root.name.toUpperCase()}</span>
      </div>

      {/* Tree — area menu on empty space */}
      <div
        className="fe-tree"
        onContextMenu={e => openAreaCtx(e, root)}
      >
        {root.children?.map(child => renderNode(child, 0))}
      </div>

      {/* Context menu */}
      {ctx && (
        <ContextMenu
          x={ctx.x}
          y={ctx.y}
          items={activeItems}
          onClose={() => setCtx(null)}
        />
      )}

      {/* Delete confirmation dialog */}
      {deleteTarget && (
        <DeleteConfirmDialog
          name={deleteTarget.name}
          isDir={deleteTarget.isDir}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {/* New file / folder dialog */}
      {newItem && (
        <NewItemDialog
          kind={newItem.kind}
          onConfirm={confirmNewItem}
          onCancel={() => setNewItem(null)}
        />
      )}
    </div>
  )
}
