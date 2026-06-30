import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { ChevronRight, ChevronDown, Search, X } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { invoke, on } from '../lib/ipc'
import ContextMenu, { ContextMenuItem } from './ContextMenu'
import DeleteConfirmDialog from './DeleteConfirmDialog'
import NewItemDialog from './NewItemDialog'
import FileIcon from './FileIcon'
import { useInstalledApps } from '../apps/sidebarRegistry'

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
  diagnosticErrors?: Set<string>
  onAddToGitIgnore?: (node: FileNode) => void
}

type CtxKind = 'file' | 'area' | 'multi'

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

const ROW_HEIGHT = 22 // px — matches .fe-node { height: 22px } in fullscreen.scss

function parentDir(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx === -1 ? path : path.substring(0, idx)
}

function hasGitChange(code: string | undefined): boolean {
  return !!code && code !== '!' && code !== 'submodule'
}

export default function FileExplorer({ root, selectedPath, onSelect, onRefresh, onLoadDir, gitStatus, diagnosticErrors, onAddToGitIgnore }: Props) {
  // ── lazy directory cache ─────────────────────────────────────────────────────
  const [dirCache,       setDirCache]       = useState<Map<string, FileNode[]>>(new Map())
  const [expanded,       setExpanded]       = useState<Set<string>>(new Set())
  const [ctx,            setCtx]            = useState<CtxState | null>(null)
  const [renaming,       setRenaming]       = useState<string | null>(null)
  const [renameVal,      setRenameVal]      = useState('')
  const [dragOver,       setDragOver]       = useState<string | null>(null)
  const [deleteTargets,  setDeleteTargets]  = useState<FileNode[]>([])
  const [newItem,        setNewItem]        = useState<{ kind: 'file' | 'folder'; dir: string } | null>(null)
  const [filterQuery,    setFilterQuery]    = useState('')
  const [multiSelection, setMultiSelection] = useState<Set<string>>(new Set())
  const dragSrc         = useRef<string | null>(null)
  const dragSrcs        = useRef<string[]>([])
  const dragExpandTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragOverTarget  = useRef<string | null>(null)
  const scrollRef       = useRef<HTMLDivElement>(null)
  const filterInputRef  = useRef<HTMLInputElement>(null)
  const lastClickedPath = useRef<string | null>(null)
  const installedApps   = useInstalledApps()

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
    setExpanded(new Set(root ? [root.path] : []))
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

  // Re-fetch root and every expanded directory.
  const refreshAll = useCallback(() => {
    if (!root) return
    void loadDir(root.path)
    for (const path of expanded) void loadDir(path)
  }, [root, expanded, loadDir])

  // Native file-watcher push ('fs:changed' {dirs:[...]}).
  const dirCacheRef = useRef(dirCache)
  useEffect(() => { dirCacheRef.current = dirCache }, [dirCache])

  useEffect(() => {
    const unsub = on('fs:changed', (data: unknown) => {
      const dirs = (data as { dirs?: string[] })?.dirs ?? []
      for (const dir of dirs) {
        if (dirCacheRef.current.has(dir)) void loadDir(dir)
      }
    })
    return () => unsub()
  }, [loadDir])

  // ── flatten the cached tree for rendering ────────────────────────────────────
  const flatRows = useMemo(() => {
    const out: FlatRow[] = []
    function walk(path: string, depth: number): void {
      const children = dirCache.get(path)
      if (!children) return
      for (const child of children) {
        out.push({ node: child, depth })
        if (child.isDir && expanded.has(child.path)) walk(child.path, depth + 1)
      }
    }
    if (root) {
      out.push({ node: root, depth: 0 })
      if (expanded.has(root.path)) walk(root.path, 1)
    }
    return out
  }, [root, dirCache, expanded])

  const filterRows = useMemo(() => {
    const q = filterQuery.trim().toLowerCase()
    if (!q || !root) return null

    function fuzzyMatch(name: string): boolean {
      const n = name.toLowerCase()
      let qi = 0
      for (let i = 0; i < n.length && qi < q.length; i++) {
        if (n[i] === q[qi]) qi++
      }
      return qi === q.length
    }

    function walkFiltered(path: string, depth: number): FlatRow[] | null {
      const children = dirCache.get(path)
      if (!children) return null
      const result: FlatRow[] = []
      for (const child of children) {
        if (child.isDir) {
          const sub = walkFiltered(child.path, depth + 1)
          if (fuzzyMatch(child.name) || sub !== null) {
            result.push({ node: child, depth })
            if (sub) result.push(...sub)
          }
        } else {
          if (fuzzyMatch(child.name)) result.push({ node: child, depth })
        }
      }
      return result.length > 0 ? result : null
    }

    const rows: FlatRow[] = [{ node: root, depth: 0 }]
    const sub = walkFiltered(root.path, 1)
    if (sub) rows.push(...sub)
    return rows
  }, [filterQuery, root, dirCache])

  const displayRows = filterRows ?? flatRows

  const virtualizer = useVirtualizer({
    count: displayRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  })

  // Right-click on a file/folder node — show batch menu when multiple items are selected.
  const openFileCtx = useCallback((e: React.MouseEvent, node: FileNode) => {
    e.preventDefault()
    e.stopPropagation()
    if (multiSelection.size > 1 && multiSelection.has(node.path)) {
      setCtx({ x: e.clientX, y: e.clientY, node, kind: 'multi' })
    } else {
      if (!multiSelection.has(node.path)) setMultiSelection(new Set())
      setCtx({ x: e.clientX, y: e.clientY, node, kind: 'file' })
    }
  }, [multiSelection])

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
    await invoke('fs.rename', { from: node.path, to: `${dir}/${renameVal.trim()}` })
    setRenaming(null)
    void loadDir(dir)
    onRefresh()
  }, [renameVal, onRefresh, loadDir])

  // Opens the delete confirm dialog for one or more nodes.
  const handleDelete = useCallback((node: FileNode) => {
    setDeleteTargets([node])
  }, [])

  const confirmDelete = useCallback(async () => {
    if (!deleteTargets.length) return
    await Promise.all(deleteTargets.map(t => invoke('fs.delete', { path: t.path }).catch(() => {})))
    const dirs = new Set(deleteTargets.map(t => parentDir(t.path)))
    for (const dir of dirs) void loadDir(dir)
    setDeleteTargets([])
    setMultiSelection(new Set())
    onRefresh()
  }, [deleteTargets, onRefresh, loadDir])

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
      await invoke('fs.create', { path: fullPath })
    } else {
      await invoke('fs.mkdir', { path: fullPath })
    }
    setExpanded(prev => new Set(prev).add(newItem.dir))
    setNewItem(null)
    void loadDir(newItem.dir)
    onRefresh()
  }, [newItem, onRefresh, loadDir])

  const handleDuplicate = useCallback(async (node: FileNode) => {
    const dir = parentDir(node.path)
    const siblings = dirCache.get(dir) ?? []
    const existingNames = new Set(siblings.map(n => n.name))

    const dotIdx = node.name.lastIndexOf('.')
    const hasDot = dotIdx > 0
    const base = hasDot ? node.name.slice(0, dotIdx) : node.name
    const ext  = hasDot ? node.name.slice(dotIdx)    : ''

    let copyName = `${base} copy${ext}`
    if (existingNames.has(copyName)) {
      let n = 2
      while (existingNames.has(`${base} copy ${n}${ext}`)) n++
      copyName = `${base} copy ${n}${ext}`
    }

    const destPath = `${dir}/${copyName}`
    await invoke('fs.copy', { from: node.path, to: destPath })
    setRenaming(destPath)
    setRenameVal(copyName)
    void loadDir(dir)
  }, [dirCache, loadDir])

  const handleCopyPath = useCallback((node: FileNode) => {
    void navigator.clipboard.writeText(node.path)
  }, [])

  const handleReveal = useCallback((node: FileNode) => {
    invoke('shell.reveal', { path: node.path }).catch(() => {})
  }, [])

  const collapseAll = useCallback(() => {
    setExpanded(new Set())
  }, [])

  // ── File-node context menu ────────────────────────────────────────────────────
  const buildFileMenu = useCallback((node: FileNode): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [
      { label: 'New File',   action: () => handleNewFile(node) },
      { label: 'New Folder', action: () => handleNewFolder(node) },
      { divider: true },
      { label: 'Rename',     action: () => startRename(node) },
      { label: 'Copy Path',  action: () => handleCopyPath(node) },
    ]
    if (!node.isDir) {
      items.push({ label: 'Duplicate', action: () => { void handleDuplicate(node) } })
    }
    // Apps contribute their own items (e.g. Live Preview adds "Open Live Preview").
    for (const app of installedApps) {
      const contributed = app.contributes?.fileExplorerContextMenu?.({
        path: node.path, name: node.name, ext: node.ext, isDir: node.isDir,
      })
      for (const item of contributed ?? []) {
        items.push({ label: item.label, action: item.action })
      }
    }
    if (onAddToGitIgnore) {
      items.push({ label: 'Add to .gitignore', action: () => onAddToGitIgnore(node) })
    }
    items.push({ divider: true }, { label: 'Delete', danger: true, action: () => handleDelete(node) })
    return items
  }, [handleNewFile, handleNewFolder, startRename, handleCopyPath, handleDuplicate, handleDelete, onAddToGitIgnore, installedApps])

  // ── Empty-area context menu ────────────────────────────────────────────────────
  const buildAreaMenu = useCallback((node: FileNode): ContextMenuItem[] => [
    { label: 'New File',         action: () => handleNewFile(node) },
    { label: 'New Folder',       action: () => handleNewFolder(node) },
    { divider: true },
    { label: 'Open in Explorer', action: () => handleReveal(node) },
    { label: 'Refresh',          action: () => { refreshAll(); onRefresh() } },
    { label: 'Collapse All',     action: collapseAll },
  ], [handleNewFile, handleNewFolder, handleReveal, refreshAll, onRefresh, collapseAll])

  // ── Multi-selection batch context menu ────────────────────────────────────────
  const buildBatchMenu = useCallback((): ContextMenuItem[] => {
    const count = multiSelection.size
    return [
      {
        label: `Delete Selected (${count})`,
        danger: true,
        action: () => {
          const targets = displayRows
            .filter(r => multiSelection.has(r.node.path))
            .map(r => r.node)
          setDeleteTargets(targets)
        },
      },
      {
        label: 'Copy Paths',
        action: () => {
          const paths = displayRows
            .filter(r => multiSelection.has(r.node.path))
            .map(r => r.node.path)
            .join('\n')
          void navigator.clipboard.writeText(paths)
        },
      },
    ]
  }, [multiSelection, displayRows])

  // ── Drag and drop ─────────────────────────────────────────────────────────────
  const clearDragExpand = () => {
    if (dragExpandTimer.current) { clearTimeout(dragExpandTimer.current); dragExpandTimer.current = null }
    dragOverTarget.current = null
  }

  const onDragStart = (e: React.DragEvent, node: FileNode) => {
    if (multiSelection.has(node.path) && multiSelection.size > 1) {
      dragSrcs.current = Array.from(multiSelection)
      dragSrc.current = null
    } else {
      dragSrcs.current = []
      dragSrc.current = node.path
    }
    e.dataTransfer.effectAllowed = 'move'
  }

  const onDragOver = (e: React.DragEvent, node: FileNode) => {
    if (!node.isDir) return
    if (dragSrcs.current.length > 0) {
      const isInvalid = dragSrcs.current.some(s =>
        node.path === s || node.path.startsWith(s + '/')
      )
      if (isInvalid) return
    } else {
      const src = dragSrc.current
      // Reject self-drop and dropping a folder into its own descendant
      if (!src || node.path === src || node.path.startsWith(src + '/')) return
    }
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOver(node.path)
    // Start auto-expand timer only when we enter a new target
    if (dragOverTarget.current !== node.path) {
      clearDragExpand()
      dragOverTarget.current = node.path
      if (!expanded.has(node.path)) {
        dragExpandTimer.current = setTimeout(() => {
          setExpanded(prev => new Set(prev).add(node.path))
          if (!dirCache.has(node.path)) void loadDir(node.path)
        }, 600)
      }
    }
  }

  const onDrop = async (e: React.DragEvent, node: FileNode) => {
    e.preventDefault()
    setDragOver(null)
    clearDragExpand()
    if (!node.isDir) return

    if (dragSrcs.current.length > 0) {
      // Multi-file move: filter out invalid sources then move all in parallel.
      const srcs = dragSrcs.current.filter(s =>
        s !== node.path && !node.path.startsWith(s + '/')
      )
      await Promise.all(srcs.map(src => {
        const name = src.split('/').pop()!
        return invoke('fs.rename', { from: src, to: `${node.path}/${name}` }).catch(() => {})
      }))
      const dirs = new Set([...srcs.map(s => parentDir(s)), node.path])
      for (const dir of dirs) void loadDir(dir)
      setMultiSelection(new Set())
      dragSrcs.current = []
      onRefresh()
      return
    }

    const src = dragSrc.current
    if (!src) return
    // Reject self-drop and ancestor drops (folder into its own subfolder)
    if (node.path === src || node.path.startsWith(src + '/')) return
    const srcName = src.split('/').pop()!
    await invoke('fs.rename', { from: src, to: `${node.path}/${srcName}` })
    dragSrc.current = null
    void loadDir(parentDir(src))
    void loadDir(node.path)
    onRefresh()
  }

  const onDragEnd = () => { dragSrc.current = null; dragSrcs.current = []; setDragOver(null); clearDragExpand() }

  // ── Flat tree row ──────────────────────────────────────────────────────────────
  function renderNode(node: FileNode, depth: number, style: React.CSSProperties, rowIndex: number): React.ReactNode {
    const isOpen          = node.isDir && expanded.has(node.path)
    const isSelected      = node.path === selectedPath
    const isMultiSelected = multiSelection.has(node.path)
    const isDragTarget    = dragOver === node.path
    const isRenamingThis  = renaming === node.path
    const gitCode         = gitStatus?.[node.path]
    const isIgnored       = gitCode === '!'
    const isGitChanged    = hasGitChange(gitCode)
    const isError         = !!(diagnosticErrors?.has(node.path))

    return (
      <div
        key={node.path}
        className={[
          'fe-node',
          isSelected      ? 'fe-node--selected'      : '',
          isMultiSelected ? 'fe-node--multi-selected' : '',
          isDragTarget    ? 'fe-node--dragover'       : '',
          isIgnored       ? 'fe-node--git-ignored'    : '',
          isError && !isSelected && !isMultiSelected                             ? 'fe-node--has-error'   : '',
          isGitChanged && !isSelected && !isMultiSelected && !isError            ? 'fe-node--git-changed' : '',
        ].join(' ')}
        style={{ ...style, paddingLeft: `${depth * 14 + 8}px` }}
        onClick={(e: React.MouseEvent) => {
          const isMeta  = e.ctrlKey || e.metaKey
          const isShift = e.shiftKey
          if (isMeta) {
            // Ctrl/Cmd+Click: toggle this item in the selection.
            setMultiSelection(prev => {
              const next = new Set(prev)
              if (next.has(node.path)) next.delete(node.path)
              else next.add(node.path)
              return next
            })
            lastClickedPath.current = node.path
          } else if (isShift) {
            // Shift+Click: select a contiguous range from the last-clicked item.
            const anchorPath = lastClickedPath.current
            const anchorIdx  = anchorPath
              ? displayRows.findIndex(r => r.node.path === anchorPath)
              : -1
            if (anchorIdx === -1) {
              setMultiSelection(new Set([node.path]))
            } else {
              const start = Math.min(anchorIdx, rowIndex)
              const end   = Math.max(anchorIdx, rowIndex)
              setMultiSelection(new Set(displayRows.slice(start, end + 1).map(r => r.node.path)))
            }
          } else {
            // Plain click: clear selection, open file or toggle folder.
            setMultiSelection(new Set())
            lastClickedPath.current = node.path
            if (node.isDir) toggle(node)
            else onSelect(node)
          }
        }}
        onContextMenu={e => openFileCtx(e, node)}
        draggable
        onDragStart={e => onDragStart(e, node)}
        onDragOver={e => onDragOver(e, node)}
        onDrop={e => onDrop(e, node)}
        onDragEnd={onDragEnd}
        onDragLeave={e => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return
          setDragOver(null)
          clearDragExpand()
        }}
      >
        <span className="fe-node__chevron">
          {node.isDir ? (
            isOpen ? <ChevronDown size={13} strokeWidth={2} /> : <ChevronRight size={13} strokeWidth={2} />
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
      </div>
    )
  }

  if (!root) {
    return <div className="fe-empty">No directory open</div>
  }

  const activeItems = ctx
    ? ctx.kind === 'area'  ? buildAreaMenu(ctx.node)
    : ctx.kind === 'multi' ? buildBatchMenu()
    : buildFileMenu(ctx.node)
    : []

  return (
    <div
      className="fe-root"
      onKeyDown={e => {
        if (e.key === 'f' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          filterInputRef.current?.focus()
        }
        if (e.key === 'Escape' && multiSelection.size > 0) {
          setMultiSelection(new Set())
          e.preventDefault()
        }
        if ((e.key === 'Delete' || e.key === 'Backspace') && multiSelection.size > 0) {
          const targets = displayRows.filter(r => multiSelection.has(r.node.path)).map(r => r.node)
          if (targets.length) setDeleteTargets(targets)
          e.preventDefault()
        }
      }}
    >
      {/* Filter input */}
      <div className="fe-search-wrap">
        <Search size={12} className="fe-search-icon" />
        <input
          ref={filterInputRef}
          className="fe-search-input"
          placeholder="Filter files..."
          value={filterQuery}
          onChange={e => setFilterQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') {
              setFilterQuery('')
              scrollRef.current?.focus()
              e.preventDefault()
            }
            e.stopPropagation()
          }}
        />
        {filterQuery && (
          <button
            className="fe-search-clear"
            onClick={() => { setFilterQuery(''); filterInputRef.current?.focus() }}
            tabIndex={-1}
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* Tree — area menu on empty space */}
      <div
        ref={scrollRef}
        className="fe-tree"
        tabIndex={-1}
        onContextMenu={e => openAreaCtx(e, root)}
      >
        <div style={{ position: 'relative', height: virtualizer.getTotalSize(), width: '100%' }}>
          {virtualizer.getVirtualItems().map(item => {
            const { node, depth } = displayRows[item.index]
            return renderNode(node, depth, {
              position: 'absolute', top: 0, left: 0, right: 0,
              height: `${item.size}px`, transform: `translateY(${item.start}px)`,
            }, item.index)
          })}
        </div>
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
      {deleteTargets.length > 0 && (
        <DeleteConfirmDialog
          targets={deleteTargets.map(t => ({ name: t.name, isDir: t.isDir }))}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTargets([])}
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
