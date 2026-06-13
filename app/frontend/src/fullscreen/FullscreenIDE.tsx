import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { EventsOn, EventsOff } from '../../wailsjs/runtime/runtime'
import { ExplorerOpen, ExplorerGetFile, ExecSilent, ReadFile, WriteFile } from '../../wailsjs/go/main/App'
import { isInstalled } from '../plugins'
import FileExplorer, { FileNode } from './FileExplorer'
import IDETabBar, { OpenFile } from './IDETabBar'
import MenuBar from './MenuBar'
import GpuEditor, { type GpuEditorHandle } from '../components/GpuEditor'
import { themeToGpuColors, type AppTheme } from '../themes'
import './fullscreen.scss'

// All git logic lives here in the frontend — the app has no git-specific code.
// ExecSilent is a generic infrastructure binding (like ReadFile/WriteFile).

async function fetchGitStatusMap(cwd: string): Promise<Record<string, string>> {
  try {
    const root = (await ExecSilent(cwd, 'git', ['-C', cwd, 'rev-parse', '--show-toplevel'])).trim().replace(/\\/g, '/')
    if (!root) return {}

    const [porcelain, gitmodulesRaw] = await Promise.all([
      ExecSilent(cwd, 'git', ['-C', cwd, 'status', '--porcelain=v1', '--ignored']),
      ReadFile(root + '/.gitmodules').catch(() => ''),
    ])

    // Parse submodule paths from .gitmodules
    const submodules = gitmodulesRaw
      .split('\n')
      .filter(l => l.trimStart().startsWith('path'))
      .map(l => l.split('=')[1]?.trim() ?? '')
      .filter(Boolean)

    const map: Record<string, string> = {}

    for (const sub of submodules) {
      map[`${root}/${sub}`] = 'submodule'
    }

    for (const line of porcelain.split('\n')) {
      if (line.length < 4) continue
      const xy = line.slice(0, 2)
      let rel = line.slice(3)
      const arrow = rel.indexOf(' -> ')
      if (arrow >= 0) rel = rel.slice(arrow + 4)
      rel = rel.replace(/\/$/, '').replace(/^"|"$/g, '')

      let code: string
      if      (xy === '!!') code = '!'
      else if (xy === '??') code = '?'
      else {
        const x = xy[0], y = xy[1]
        code = (x !== ' ' && x !== '.') ? x : (y !== ' ' && y !== '.') ? y : ''
      }
      if (!code || !rel) continue

      const abs = `${root}/${rel}`
      if (!map[abs]) map[abs] = code

      // Propagate dirty indicator up into parent directories
      if (code !== '!') {
        const parts = rel.split('/')
        for (let i = 1; i < parts.length; i++) {
          const dirAbs = `${root}/${parts.slice(0, i).join('/')}`
          if (!map[dirAbs] || map[dirAbs] === '!') map[dirAbs] = 'dirty'
        }
      }
    }

    return map
  } catch {
    return {}
  }
}

function langFromExt(ext: string): string {
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    go: 'go', py: 'python', rs: 'rust', json: 'json', md: 'markdown',
    css: 'css', html: 'html', sh: 'shell', bash: 'shell', yml: 'yaml',
    yaml: 'yaml', toml: 'ini', xml: 'xml', c: 'c', cpp: 'cpp',
    h: 'c', cs: 'csharp', java: 'java', rb: 'ruby', php: 'php',
    swift: 'swift', kt: 'kotlin', sql: 'sql', graphql: 'graphql',
  }
  return map[ext] ?? 'plaintext'
}

interface Props {
  cwd: string
  theme: AppTheme
  indentGuides: boolean
  minimap: boolean
  wordWrap: boolean
  defaultZoom: number
}

interface PaneStatus {
  line: number
  col: number
  totalLines: number
  eol: 'LF' | 'CRLF'
}

const INITIAL_PANE_STATUS: PaneStatus = { line: 1, col: 1, totalLines: 0, eol: 'LF' }

export default function FullscreenIDE({ cwd, theme, minimap, defaultZoom }: Props) {
  // ── file state ───────────────────────────────────────────────────────────────
  const [openFiles,  setOpenFiles]  = useState<OpenFile[]>([])
  const [leftActive, setLeftActive] = useState<string | null>(null)
  const [rightActive,setRightActive]= useState<string | null>(null)

  // ── panel / layout state ─────────────────────────────────────────────────────
  const [focusedPanel, setFocusedPanel] = useState<'left' | 'right'>('left')
  const [splitMode,    setSplitMode]    = useState(false)
  const [splitRatio,   setSplitRatio]   = useState(0.5)

  // ── explorer state ────────────────────────────────────────────────────────────
  const [tree,          setTree]          = useState<FileNode | null>(null)
  const [gitStatusMap,  setGitStatusMap]  = useState<Record<string, string>>({})
  const [explorerW,   setExplorerW]   = useState(220)
  const [explorerPos, setExplorerPos] = useState<'left' | 'right'>('left')
  const [collapsed,   setCollapsed]   = useState(false)

  // ── tab multi-select ─────────────────────────────────────────────────────────
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())

  // ── drag-and-drop ─────────────────────────────────────────────────────────────
  const [draggedTab, setDraggedTab] = useState<string | null>(null)

  // ── status bar (per-panel — each GpuEditor reports its own state) ─────────────
  const [leftStatus,  setLeftStatus]  = useState<PaneStatus>(INITIAL_PANE_STATUS)
  const [rightStatus, setRightStatus] = useState<PaneStatus>(INITIAL_PANE_STATUS)
  const [fontSize,   setFontSize]   = useState(() => Math.round(13 * defaultZoom))

  // ── editor refs ───────────────────────────────────────────────────────────────
  const leftEditorRef  = useRef<GpuEditorHandle>(null)
  const rightEditorRef = useRef<GpuEditorHandle>(null)

  // ── stable refs (avoid stale closures in memoised callbacks) ─────────────────
  const leftActiveRef   = useRef<string | null>(null)
  const rightActiveRef  = useRef<string | null>(null)
  const focusedPanelRef = useRef<'left' | 'right'>('left')
  const splitModeRef    = useRef(false)
  const openFilesRef    = useRef<OpenFile[]>([])

  useEffect(() => { leftActiveRef.current   = leftActive    }, [leftActive])
  useEffect(() => { rightActiveRef.current  = rightActive   }, [rightActive])
  useEffect(() => { focusedPanelRef.current = focusedPanel  }, [focusedPanel])
  useEffect(() => { splitModeRef.current    = splitMode     }, [splitMode])
  useEffect(() => { openFilesRef.current    = openFiles     }, [openFiles])

  // ── divider drag ref ──────────────────────────────────────────────────────────
  const draggingExplorer = useRef(false)
  const draggingSplit    = useRef(false)
  const containerRef     = useRef<HTMLDivElement>(null)

  // ── derived ───────────────────────────────────────────────────────────────────
  const activeFile    = focusedPanel === 'left' ? leftActive : rightActive
  const activeFileObj = openFiles.find(f => f.path === activeFile)
  const activeStatus  = focusedPanel === 'left' ? leftStatus : rightStatus

  // ── GPU editor colors derived from the active theme ──────────────────────────
  const gpuColors = useMemo(() => themeToGpuColors(theme), [theme])

  // ── theme CSS vars ────────────────────────────────────────────────────────────
  const themeVars = useMemo((): React.CSSProperties => ({
    '--ide-bg':        theme.appBg,
    '--ide-bg-alt':    theme.infoBarBg,
    '--ide-bg-hi':     theme.infoBarHoverBg,
    '--ide-border':    theme.borderColor,
    '--ide-border-lo': theme.tabAddBorder,
    '--ide-text-lo':   theme.infoBarColor,
    '--ide-text-mid':  theme.tabColor,
    '--ide-text-hi':   theme.tabColorHover,
    '--ide-fg':        theme.infoBarHoverColor,
    '--ide-accent':    gpuColors.cursor,
    '--ide-select':    gpuColors.selection.slice(0, 7),
    '--ide-editor-bg': gpuColors.bg,
  } as React.CSSProperties), [theme, gpuColors])

  // ── zoom sync ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    setFontSize(Math.round(13 * defaultZoom))
  }, [defaultZoom])

  // ── tree loading ──────────────────────────────────────────────────────────────
  const loadTree = useCallback(async () => {
    if (!cwd) return
    // Render the tree immediately — never block on git status
    setTree(await ExplorerOpen(cwd) as FileNode)
    // Fetch git badges in the background; they paint in once ready
    if (isInstalled('git')) void fetchGitStatusMap(cwd).then(setGitStatusMap)
  }, [cwd])

  useEffect(() => { void loadTree() }, [loadTree])

  useEffect(() => {
    EventsOn('fullscreen:tree', (node: FileNode) => setTree(node))
    return () => EventsOff('fullscreen:tree')
  }, [])

  // Live-reload open file content when the file changes on disk externally.
  // Dirty files (user has unsaved edits) are intentionally skipped so we
  // never silently overwrite work in progress.
  useEffect(() => {
    EventsOn('fullscreen:file-changed', (changedPath: string) => {
      const file = openFilesRef.current.find(f => f.path === changedPath)
      if (!file || file.dirty) return
      ExplorerGetFile(changedPath)
        .then(content => {
          setOpenFiles(prev => prev.map(f =>
            f.path === changedPath && !f.dirty ? { ...f, content } : f
          ))
        })
        .catch(() => {})
    })
    return () => EventsOff('fullscreen:file-changed')
  }, [])

  // ── switch active file in a panel ──────────────────────────────────────────
  const switchActiveFile = useCallback((panel: 'left' | 'right', path: string | null) => {
    if (panel === 'left') setLeftActive(path)
    else setRightActive(path)
  }, [])

  // ── open file (with preview-replacement logic) ────────────────────────────────
  const openFile = useCallback(async (node: FileNode, targetPanel?: 'left' | 'right') => {
    if (node.isDir) return

    // Already open: just activate it in its panel
    const already = openFiles.find(f => f.path === node.path)
    if (already) {
      switchActiveFile(already.panel, node.path)
      setFocusedPanel(already.panel)
      setSelectedPaths(new Set())
      return
    }

    try {
      const content = await ExplorerGetFile(node.path)
      const panel = targetPanel ?? focusedPanelRef.current
      const panelActive = panel === 'left' ? leftActiveRef.current : rightActiveRef.current
      const newFile: OpenFile = {
        path: node.path, name: node.name, content,
        dirty: false, language: langFromExt(node.ext),
        pinned: false, panel,
      }

      setOpenFiles(prev => {
        // Replace the current preview (unpinned active file) in this panel
        const preview = prev.find(f => f.panel === panel && !f.pinned && f.path === panelActive)
        if (preview) return prev.map(f => f.path === preview.path ? newFile : f)
        return [...prev, newFile]
      })

      switchActiveFile(panel, node.path)
      setFocusedPanel(panel)
      setSelectedPaths(new Set())
    } catch { /* permission error */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFiles, switchActiveFile])

  // ── close files ───────────────────────────────────────────────────────────────
  const closeFiles = useCallback((paths: string[]) => {
    const pathSet = new Set(paths)
    setOpenFiles(prev => {
      const next = prev.filter(f => !pathSet.has(f.path))

      // Repair left active
      if (pathSet.has(leftActiveRef.current ?? '')) {
        const leftVisible = next.filter(f => f.panel === 'left' && (f.pinned))
        setLeftActive(leftVisible.length ? leftVisible[leftVisible.length - 1].path : null)
      }
      // Repair right active
      if (pathSet.has(rightActiveRef.current ?? '')) {
        const rightVisible = next.filter(f => f.panel === 'right' && f.pinned)
        setRightActive(rightVisible.length ? rightVisible[rightVisible.length - 1].path : null)
      }
      // Collapse split if right panel is now empty
      if (!next.some(f => f.panel === 'right')) setSplitMode(false)

      return next
    })
    setSelectedPaths(prev => {
      const next = new Set(prev)
      paths.forEach(p => next.delete(p))
      return next
    })
  }, [])

  // ── move to panel ─────────────────────────────────────────────────────────────
  const moveToPanel = useCallback((paths: string[], target: 'left' | 'right') => {
    setOpenFiles(prev => prev.map(f =>
      paths.includes(f.path) ? { ...f, panel: target, pinned: true } : f
    ))
    setSplitMode(true)
    switchActiveFile(target, paths[0])
    setFocusedPanel(target)
    setSelectedPaths(new Set())
  }, [switchActiveFile])

  // ── tab multi-select ──────────────────────────────────────────────────────────
  const handleSelectTab = useCallback((path: string, e: React.MouseEvent) => {
    const panel = focusedPanelRef.current
    const panelActive = panel === 'left' ? leftActiveRef.current : rightActiveRef.current
    const visible = openFiles.filter(f => f.panel === panel && (f.pinned || f.path === panelActive))

    if (e.shiftKey) {
      const anchor = [...selectedPaths][0] ?? path
      const aIdx = visible.findIndex(f => f.path === anchor)
      const tIdx = visible.findIndex(f => f.path === path)
      if (aIdx !== -1 && tIdx !== -1) {
        const [lo, hi] = [Math.min(aIdx, tIdx), Math.max(aIdx, tIdx)]
        setSelectedPaths(new Set(visible.slice(lo, hi + 1).map(f => f.path)))
      }
    } else {
      setSelectedPaths(prev => {
        const next = new Set(prev)
        if (next.has(path)) { next.delete(path) } else { next.add(path) }
        return next
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFiles, selectedPaths])

  // ── activate tab ─────────────────────────────────────────────────────────────
  const activateFile = useCallback((path: string) => {
    const file = openFiles.find(f => f.path === path)
    if (!file) return
    switchActiveFile(file.panel, path)
    setFocusedPanel(file.panel)
    setSelectedPaths(new Set())
  }, [openFiles, switchActiveFile])

  // ── drag-and-drop between panels ─────────────────────────────────────────────
  const onTabDragStart = useCallback((e: React.DragEvent, path: string) => {
    setDraggedTab(path)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', path)
  }, [])

  const onPanelDrop = useCallback((e: React.DragEvent, targetPanel: 'left' | 'right') => {
    e.preventDefault()
    const path = e.dataTransfer.getData('text/plain') || draggedTab
    if (!path) return
    const file = openFiles.find(f => f.path === path)
    if (!file || file.panel === targetPanel) return
    moveToPanel([path], targetPanel)
    setDraggedTab(null)
  }, [draggedTab, openFiles, moveToPanel])

  // ── save ─────────────────────────────────────────────────────────────────────
  const saveFile = useCallback(async () => {
    const panel = focusedPanelRef.current
    const ref = panel === 'left' ? leftEditorRef.current : rightEditorRef.current
    await ref?.save()
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); void saveFile() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [saveFile])

  // ── explorer resize ───────────────────────────────────────────────────────────
  const onExplorerDividerDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    draggingExplorer.current = true
    const startX = e.clientX
    const startW = explorerW
    const onMove = (ev: MouseEvent) => {
      if (!draggingExplorer.current) return
      const delta = explorerPos === 'left' ? ev.clientX - startX : startX - ev.clientX
      setExplorerW(Math.max(140, Math.min(480, startW + delta)))
    }
    const onUp = () => {
      draggingExplorer.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [explorerW, explorerPos])

  // ── split pane resize ─────────────────────────────────────────────────────────
  const onSplitDividerDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    draggingSplit.current = true
    const onMove = (ev: MouseEvent) => {
      if (!draggingSplit.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      // account for explorer width
      const explorerOffset = collapsed ? 36 : explorerW
      const editorLeft  = explorerPos === 'left' ? rect.left + explorerOffset + 1 : rect.left
      const editorWidth = rect.width - explorerOffset - 1
      const ratio = (ev.clientX - editorLeft) / editorWidth
      setSplitRatio(Math.max(0.2, Math.min(0.8, ratio)))
    }
    const onUp = () => {
      draggingSplit.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [explorerW, explorerPos, collapsed])

  // ── render helpers ────────────────────────────────────────────────────────────
  const leftFileObj  = openFiles.find(f => f.path === leftActive)
  const rightFileObj = openFiles.find(f => f.path === rightActive)

  const renderEditor = (
    fileObj: OpenFile | undefined,
    editorRef: React.RefObject<GpuEditorHandle>,
    viewKey: 'left' | 'right',
  ) => {
    if (!fileObj) {
      return (
        <div className="ide-editor__empty">
          <div className="ide-editor__empty-hint">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/>
              <polyline points="13 2 13 9 20 9"/>
            </svg>
            <p>Select a file to open</p>
          </div>
        </div>
      )
    }
    const setStatus = viewKey === 'left' ? setLeftStatus : setRightStatus
    return (
      <GpuEditor
        key={fileObj.path}
        ref={editorRef}
        filePath={fileObj.path}
        fontSize={fontSize}
        colors={gpuColors}
        minimap={minimap}
        viewKey={viewKey}
        showHeader={false}
        onCursorChange={(line, col) => setStatus(s => ({ ...s, line: line + 1, col: col + 1 }))}
        onLineCountChange={n => setStatus(s => ({ ...s, totalLines: n }))}
        onEolChange={eol => setStatus(s => ({ ...s, eol }))}
        onDirtyChange={dirty => setOpenFiles(prev => prev.map(f =>
          f.path === fileObj.path ? { ...f, dirty, pinned: dirty ? true : f.pinned } : f
        ))}
      />
    )
  }

  // ── git ignore ────────────────────────────────────────────────────────────────
  const handleAddToGitIgnore = useCallback(async (node: FileNode) => {
    const cwdSlash = cwd.replace(/\\/g, '/')
    const relPath = node.path.startsWith(cwdSlash + '/')
      ? node.path.slice(cwdSlash.length + 1)
      : node.path
    const gitignorePath = cwdSlash + '/.gitignore'

    const existing = await ReadFile(gitignorePath).catch(() => '')
    // Skip if already present
    if (existing.split('\n').some(l => l.trim() === relPath)) return
    const newContent = (existing && !existing.endsWith('\n') ? existing + '\n' : existing) + relPath + '\n'
    await WriteFile(gitignorePath, newContent)

    // Refresh git status so the ignored indicator appears immediately
    setGitStatusMap(await fetchGitStatusMap(cwd))
  }, [cwd])

  // ── explorer panel ────────────────────────────────────────────────────────────
  const explorerPanel = (
    <div
      className={`ide-explorer${collapsed ? ' ide-explorer--collapsed' : ''}`}
      style={{ width: collapsed ? 36 : explorerW }}
    >
      {collapsed ? (
        <button className="ide-explorer__expand-btn" onClick={() => setCollapsed(false)} title="Expand">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M6 2l6 6-6 6V2z"/>
          </svg>
        </button>
      ) : (
        <>
          <div className="ide-explorer__toolbar">
            <span className="ide-explorer__title">Explorer</span>
            <div className="ide-explorer__actions">
              <button title="Move explorer" onClick={() => setExplorerPos(p => p === 'left' ? 'right' : 'left')}>
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M3 2h10a1 1 0 011 1v10a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1zm7 1H3v10h7V3zm1 0v10h2V3h-2z"/>
                </svg>
              </button>
              <button title="Collapse" onClick={() => setCollapsed(true)}>
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M10 2L4 8l6 6V2z"/>
                </svg>
              </button>
            </div>
          </div>
          <FileExplorer
            root={tree}
            selectedPath={activeFile ?? ''}
            onSelect={node => openFile(node)}
            onRefresh={loadTree}
            gitStatus={Object.keys(gitStatusMap).length > 0 ? gitStatusMap : undefined}
            onAddToGitIgnore={isInstalled('git') ? handleAddToGitIgnore : undefined}
          />
        </>
      )}
    </div>
  )

  // ── editor area ───────────────────────────────────────────────────────────────
  const editorArea = (
    <div className="ide-editor-area">
      {/* Panes row */}
      <div className="ide-panes-row" ref={containerRef}>
        {/* Left pane */}
        <div
          className={`ide-pane${focusedPanel === 'left' ? ' ide-pane--focused' : ''}`}
          style={{ flex: splitMode ? splitRatio : 1 }}
          onClick={() => setFocusedPanel('left')}
        >
          <IDETabBar
            files={openFiles}
            panel="left"
            activeFile={leftActive}
            selectedPaths={selectedPaths}
            onActivate={activateFile}
            onClose={closeFiles}
            onMoveToPanel={moveToPanel}
            onSelectTab={handleSelectTab}
            onDragStart={onTabDragStart}
            onDrop={onPanelDrop}
          />
          <div className="ide-editor">
            {renderEditor(leftFileObj, leftEditorRef, 'left')}
          </div>
        </div>

        {/* Split divider + right pane */}
        {splitMode && (
          <>
            <div className="ide-pane-divider" onMouseDown={onSplitDividerDown} />
            <div
              className={`ide-pane${focusedPanel === 'right' ? ' ide-pane--focused' : ''}`}
              style={{ flex: 1 - splitRatio }}
              onClick={() => setFocusedPanel('right')}
            >
              <IDETabBar
                files={openFiles}
                panel="right"
                activeFile={rightActive}
                selectedPaths={selectedPaths}
                onActivate={activateFile}
                onClose={closeFiles}
                onMoveToPanel={moveToPanel}
                onSelectTab={handleSelectTab}
                onDragStart={onTabDragStart}
                onDrop={onPanelDrop}
              />
              <div className="ide-editor">
                {renderEditor(rightFileObj, rightEditorRef, 'right')}
              </div>
            </div>
          </>
        )}
      </div>{/* end ide-panes-row */}

      {/* Status bar — spans full width below both panes */}
      <div className="ide-statusbar">
        <span className="ide-statusbar__segment">
          <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: 0.8 }}>
            <path d="M2 2h5v5H2V2zm0 7h5v5H2V9zm7-7h5v5H9V2zm0 7h5v5H9V9z"/>
          </svg>
          IDE
        </span>
        <span className="ide-statusbar__path">{activeFileObj?.path ?? ''}</span>
        {activeFileObj?.dirty && <span className="ide-statusbar__dirty" />}
        {activeFileObj && (
          <>
            <span className="ide-statusbar__segment ide-statusbar__segment--right">UTF-8</span>
            <span className="ide-statusbar__segment ide-statusbar__segment--right">{activeStatus.eol}</span>
            <span className="ide-statusbar__segment ide-statusbar__segment--right">Spaces: 2</span>
            <span className="ide-statusbar__segment ide-statusbar__segment--right">{activeFileObj.language}</span>
            <span className="ide-statusbar__segment ide-statusbar__segment--right">
              Ln {activeStatus.line}/{activeStatus.totalLines}  Col {activeStatus.col}
            </span>
          </>
        )}
      </div>
    </div>
  )

  // ── explorer divider ──────────────────────────────────────────────────────────
  const explorerDivider = <div className="ide-divider" onMouseDown={onExplorerDividerDown} />

  // Stable getter so MenuBar always reads the currently-focused editor
  const getEditor = useCallback(() => {
    const handle = focusedPanelRef.current === 'left' ? leftEditorRef.current : rightEditorRef.current
    if (!handle) return null
    return {
      focus: handle.focus,
      // Monaco-command compatibility shim for MenuBar: only undo/redo map
      // onto the GPU editor today. Find/replace, format, minimap toggle,
      // smart selection, go-to-symbol, etc. are addressed in later phases.
      trigger: (_source: string, cmd: string) => {
        if (cmd === 'undo') handle.undo()
        else if (cmd === 'redo') handle.redo()
      },
    }
  }, [])

  // MenuBar zoom helpers (mirror what the scroll-wheel handler does)
  const zoomIn    = useCallback(() => setFontSize(f => Math.min(f + 1, 36)), [])
  const zoomOut   = useCallback(() => setFontSize(f => Math.max(f - 1, 8)), [])
  const resetZoom = useCallback(() => setFontSize(Math.round(13 * defaultZoom)), [defaultZoom])

  // Close the active file in the focused panel
  const closeActive = useCallback(() => {
    const path = focusedPanelRef.current === 'left' ? leftActiveRef.current : rightActiveRef.current
    if (path) closeFiles([path])
  }, [closeFiles])

  const menuBar = (
    <MenuBar
      onSave={saveFile}
      onCloseActive={closeActive}
      onCloseAll={() => closeFiles(openFiles.map(f => f.path))}
      onToggleExplorer={() => setCollapsed(c => !c)}
      onToggleSplit={() => setSplitMode(s => !s)}
      onZoomIn={zoomIn}
      onZoomOut={zoomOut}
      onResetZoom={resetZoom}
      getEditor={getEditor}
    />
  )

  // MenuBar sits above the editor area only — aligned with the code, not the explorer.
  const mainCol = (
    <div className="ide-main-col">
      {menuBar}
      {editorArea}
    </div>
  )

  return (
    <div className="ide-root" style={themeVars}>
      {explorerPos === 'left'
        ? <>{explorerPanel}{explorerDivider}{mainCol}</>
        : <>{mainCol}{explorerDivider}{explorerPanel}</>
      }
    </div>
  )
}
