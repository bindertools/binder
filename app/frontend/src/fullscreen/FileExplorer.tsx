import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react'
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
  onLoadDir: (path: string) => Promise<FileNode[]>
  gitStatus?: Record<string, string>
  onAddToGitIgnore?: (node: FileNode) => void
}

type CtxKind = 'file' | 'area'

interface CtxState {
  x: number
  y: number
  node: FileNode
  kind: CtxKind
}

interface FlatRow {
  node: FileNode
  depth: number
}

function parentDir(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx === -1 ? path : path.substring(0, idx)
}

function gitBadge(code: string | undefined): React.ReactNode {
  if (!code || code === '!') return null
  if (code === 'dirty') return <span className="fe-git-badge fe-git-badge--dirty" />
  const [label, mod] =
    code === 'M' || code === 'T' || code === 'C' || code === 'R' ? ['M', 'modified'] :
    code === 'A'   ? ['A', 'added']     :
    code === '?'   ? ['U', 'untracked'] :
    code === 'D'   ? ['D', 'deleted']   :
    code === 'submodule' ? ['S', 'submodule'] :
    [code, 'modified']
  return <span className={`fe-git-badge fe-git-badge--${mod}`}>{label}</span>
}

export default function FileExplorer({ root, selectedPath, onSelect, onRefresh, onLoadDir, gitStatus, onAddToGitIgnore }: Props) {
  // ── lazy directory cache ─────────────────────────────────────────────────────
  const [dirCache,     setDirCache]     = useState<Map<string, FileNode[]>>(new Map())
  const [expanded,     setExpanded]     = useState<Set<string>>(new Set())
  const [ctx,          setCtx]          = useState<CtxState | null>(null)
  const [renaming,     setRenaming]     = useState<string | null>(null)
  const [renameVal,    setRenameVal]    = useState('')
  const [dragOver,     setDragOver]     = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<FileNode | null>(null)
  const [newItem,      setNewItem]      = useState<{ kind: 'file' | 'folder'; dir: string } | null>(null)
  const dragSrc = useRef<string | null>(null)

  // (Re)fetch a directory's children and store them in the cache.
  const loadDir = useCallback(async (path: string) => {
    try {
      const children = await onLoadDir(path)
      setDirCache(prev => new Map(prev).set(path, children))
    } catch {
      setDirCache(prev => new Map(prev).set(path, []))
    }
  }, [onLoadDir])

  // New root (cwd changed) — reset cache/expansion and load the root's children.
  useEffect(() => {
    setExpanded(new Set())
    setDirCache(new Map())
    if (root) void loadDir(root.path)
  }, [root?.path, loadDir])

  const toggle = useCallback((node: FileNode) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(node.path)) {
        next.delete(node.path)
      } else {
        next.add(node.path)
        if (!dirCache.has(node.path)) void loadDir(node.path)
      }
      return next
    })
  }, [dirCache, loadDir])

  // Re-fetch the root and every expanded directory (e.g. after a mutation
  // whose exact target dir we don't want to track individually, or the
  // "Refresh" context menu action).
  const refreshAll = useCallback(() => {
    if (!root) return
    void loadDir(root.path)
    for (const path of expanded) void loadDir(path)
  }, [root, expanded, loadDir])

  // ── flatten the cached tree for rendering ───────────────────────────────────
  const flatRows = useMemo(() => {
    const out: FlatRow[] = []
    function walk(path: string, depth: number) {
      const children = dirCache.get(path)
      if (!children) return
      for (const child of children) {
        out.push({ node: child, depth })
        if (child.isDir && expanded.has(child.path)) walk(child.path, depth + 1)
      }
    }
    if (root) walk(root.path, 0)
    return out
  }, [root, dirCache, expanded])

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
    const dir = parentDir(node.path)
    await ExplorerRename(node.path, `${dir}/${renameVal.trim()}`)
    setRenaming(null)
    void loadDir(dir)
    onRefresh()
  }, [renameVal, onRefresh, loadDir])

  // Opens the custom delete confirm dialog
  const handleDelete = useCallback((node: FileNode) => {
    setDeleteTarget(node)
  }, [])

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return
    await ExplorerDelete(deleteTarget.path)
    setDeleteTarget(null)
    void loadDir(parentDir(deleteTarget.path))
    onRefresh()
  }, [deleteTarget, onRefresh, loadDir])

  const handleNewFile = useCallback((node: FileNode) => {
    const dir = node.isDir ? node.path : parentDir(node.path)
    setNewItem({ kind: 'file', dir })
    setCtx(null)
  }, [])

  const handleNewFolder = useCallback((node: FileNode) => {
    const dir = node.isDir ? node.path : parentDir(node.path)
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
    void loadDir(newItem.dir)
    onRefresh()
  }, [newItem, onRefresh, loadDir])

  const handleCopyPath = useCallback((node: FileNode) => {
    void navigator.clipboard.writeText(node.path)
  }, [])

  const handleReveal = useCallback((node: FileNode) => {
    ExplorerReveal(node.path).catch(() => {})
  }, [])

  const collapseAll = useCallback(() => {
    setExpanded(new Set())
  }, [])

  // ── File-node context menu — no icons ──────────────────────────────────────
  const buildFileMenu = useCallback((node: FileNode): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [
      { label: 'New File',   action: () => handleNewFile(node) },
      { label: 'New Folder', action: () => handleNewFolder(node) },
      { divider: true },
      { label: 'Rename',     action: () => startRename(node) },
      { label: 'Copy Path',  action: () => handleCopyPath(node) },
    ]
    if (onAddToGitIgnore) {
      items.push({ label: 'Add to .gitignore', action: () => onAddToGitIgnore(node) })
    }
    items.push({ divider: true }, { label: 'Delete', danger: true, action: () => handleDelete(node) })
    return items
  }, [handleNewFile, handleNewFolder, startRename, handleCopyPath, handleDelete, onAddToGitIgnore])

  // ── Empty-area context menu — acts on root dir ─────────────────────────────
  const buildAreaMenu = useCallback((node: FileNode): ContextMenuItem[] => [
    { label: 'New File',         action: () => handleNewFile(node) },
    { label: 'New Folder',       action: () => handleNewFolder(node) },
    { divider: true },
    { label: 'Open in Explorer', action: () => handleReveal(node) },
    { label: 'Refresh',          action: () => { refreshAll(); onRefresh() } },
    { label: 'Collapse All',     action: collapseAll },
  ], [handleNewFile, handleNewFolder, handleReveal, refreshAll, onRefresh, collapseAll])

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
    const src = dragSrc.current
    const srcName = src.split('/').pop()!
    await ExplorerMove(src, `${node.path}/${srcName}`)
    dragSrc.current = null
    void loadDir(parentDir(src))
    void loadDir(node.path)
    onRefresh()
  }

  const onDragEnd = () => { dragSrc.current = null; setDragOver(null) }

  // ── Flat tree row ──────────────────────────────────────────────────────────
  function renderNode(node: FileNode, depth: number): React.ReactNode {
    const isOpen        = node.isDir && expanded.has(node.path)
    const isSelected    = node.path === selectedPath
    const isDragTarget  = dragOver === node.path
    const isRenamingThis = renaming === node.path
    const gitCode       = gitStatus?.[node.path]
    const isIgnored     = gitCode === '!'

    return (
      <div
        key={node.path}
        className={[
          'fe-node',
          isSelected   ? 'fe-node--selected' : '',
          isDragTarget ? 'fe-node--dragover'  : '',
          isIgnored    ? 'fe-node--git-ignored' : '',
        ].join(' ')}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        onClick={() => {
          if (node.isDir) toggle(node)
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
              if (e.key === 'Enter') void commitRename(node)
              if (e.key === 'Escape') setRenaming(null)
              e.stopPropagation()
            }}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span className="fe-node__name">{node.name}</span>
        )}
        {gitBadge(gitCode)}
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
        <span className="fe-header__name">{root.name.toUpperCase()}</span>
      </div>

      {/* Tree — area menu on empty space */}
      <div
        className="fe-tree"
        onContextMenu={e => openAreaCtx(e, root)}
      >
        {flatRows.map(({ node, depth }) => renderNode(node, depth))}
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
