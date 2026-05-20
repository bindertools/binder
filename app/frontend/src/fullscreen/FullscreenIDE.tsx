import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import MonacoEditor from '@monaco-editor/react'
import { EventsOn, EventsOff } from '../../wailsjs/runtime/runtime'
import { ExplorerOpen, ExplorerGetFile, ExplorerSaveFile } from '../../wailsjs/go/main/App'
import FileExplorer, { FileNode } from './FileExplorer'
import IDETabBar, { OpenFile } from './IDETabBar'
import type { AppTheme } from '../themes'
import './fullscreen.css'

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

export default function FullscreenIDE({ cwd, theme, indentGuides, minimap, wordWrap, defaultZoom }: Props) {
  // ── file state ───────────────────────────────────────────────────────────────
  const [openFiles,  setOpenFiles]  = useState<OpenFile[]>([])
  const [leftActive, setLeftActive] = useState<string | null>(null)
  const [rightActive,setRightActive]= useState<string | null>(null)

  // ── panel / layout state ─────────────────────────────────────────────────────
  const [focusedPanel, setFocusedPanel] = useState<'left' | 'right'>('left')
  const [splitMode,    setSplitMode]    = useState(false)
  const [splitRatio,   setSplitRatio]   = useState(0.5)

  // ── explorer state ────────────────────────────────────────────────────────────
  const [tree,        setTree]        = useState<FileNode | null>(null)
  const [explorerW,   setExplorerW]   = useState(220)
  const [explorerPos, setExplorerPos] = useState<'left' | 'right'>('left')
  const [collapsed,   setCollapsed]   = useState(false)

  // ── tab multi-select ─────────────────────────────────────────────────────────
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())

  // ── drag-and-drop ─────────────────────────────────────────────────────────────
  const [draggedTab, setDraggedTab] = useState<string | null>(null)

  // ── status bar ───────────────────────────────────────────────────────────────
  const [statusLine, setStatusLine] = useState({ line: 1, col: 1 })
  const [lineEnding, setLineEnding] = useState<'CRLF' | 'LF'>('LF')
  const [tabSize,    setTabSize]    = useState(2)
  const [totalLines, setTotalLines] = useState(0)
  const [fontSize,   setFontSize]   = useState(() => Math.round(13 * defaultZoom))

  // ── editor refs ───────────────────────────────────────────────────────────────
  const leftEditorRef  = useRef<any>(null)
  const leftMonacoRef  = useRef<any>(null)
  const rightEditorRef = useRef<any>(null)
  const rightMonacoRef = useRef<any>(null)

  // ── stable refs (avoid stale closures in memoised callbacks) ─────────────────
  const leftActiveRef   = useRef<string | null>(null)
  const rightActiveRef  = useRef<string | null>(null)
  const focusedPanelRef = useRef<'left' | 'right'>('left')
  const splitModeRef    = useRef(false)

  useEffect(() => { leftActiveRef.current   = leftActive    }, [leftActive])
  useEffect(() => { rightActiveRef.current  = rightActive   }, [rightActive])
  useEffect(() => { focusedPanelRef.current = focusedPanel  }, [focusedPanel])
  useEffect(() => { splitModeRef.current    = splitMode     }, [splitMode])

  // ── divider drag ref ──────────────────────────────────────────────────────────
  const draggingExplorer = useRef(false)
  const draggingSplit    = useRef(false)
  const containerRef     = useRef<HTMLDivElement>(null)

  // ── derived ───────────────────────────────────────────────────────────────────
  const activeFile    = focusedPanel === 'left' ? leftActive : rightActive
  const activeFileObj = openFiles.find(f => f.path === activeFile)

  // ── theme CSS vars ────────────────────────────────────────────────────────────
  const themeVars = useMemo((): React.CSSProperties => {
    const mc = theme.monacoThemeDef?.colors ?? {}
    const editorBg  = mc['editor.background']       ?? theme.appBg
    const accent    = mc['editorCursor.foreground']  ?? '#51afef'
    const selection = (mc['editor.selectionBackground'] ?? '#2257a0').slice(0, 7)
    return {
      '--ide-bg':        theme.appBg,
      '--ide-bg-alt':    theme.infoBarBg,
      '--ide-bg-hi':     theme.infoBarHoverBg,
      '--ide-border':    theme.borderColor,
      '--ide-border-lo': theme.tabAddBorder,
      '--ide-text-lo':   theme.infoBarColor,
      '--ide-text-mid':  theme.tabColor,
      '--ide-text-hi':   theme.tabColorHover,
      '--ide-fg':        theme.infoBarHoverColor,
      '--ide-accent':    accent,
      '--ide-select':    selection,
      '--ide-editor-bg': editorBg,
    } as React.CSSProperties
  }, [theme])

  // ── zoom / option sync ────────────────────────────────────────────────────────
  useEffect(() => {
    const next = Math.round(13 * defaultZoom)
    setFontSize(next)
    leftEditorRef.current?.updateOptions({ fontSize: next })
    rightEditorRef.current?.updateOptions({ fontSize: next })
  }, [defaultZoom])

  useEffect(() => {
    const opts = {
      minimap: { enabled: minimap },
      wordWrap: wordWrap ? 'on' : 'off',
      guides: {
        indentation: indentGuides,
        bracketPairs: indentGuides,
        bracketPairsHorizontal: indentGuides,
        highlightActiveIndentation: indentGuides,
      },
    }
    leftEditorRef.current?.updateOptions(opts)
    rightEditorRef.current?.updateOptions(opts)
  }, [minimap, wordWrap, indentGuides])

  // ── tree loading ──────────────────────────────────────────────────────────────
  const loadTree = useCallback(async () => {
    if (!cwd) return
    setTree(await ExplorerOpen(cwd) as FileNode)
  }, [cwd])

  useEffect(() => { loadTree() }, [loadTree])

  useEffect(() => {
    EventsOn('fullscreen:tree', (node: FileNode) => setTree(node))
    return () => EventsOff('fullscreen:tree')
  }, [])

  // ── open file (with preview-replacement logic) ────────────────────────────────
  const openFile = useCallback(async (node: FileNode, targetPanel?: 'left' | 'right') => {
    if (node.isDir) return

    // Already open: just activate it in its panel
    const already = openFiles.find(f => f.path === node.path)
    if (already) {
      if (already.panel === 'left') setLeftActive(node.path)
      else setRightActive(node.path)
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

      if (panel === 'left') setLeftActive(node.path)
      else setRightActive(node.path)
      setFocusedPanel(panel)
      setSelectedPaths(new Set())
    } catch { /* permission error */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFiles])

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
    if (target === 'right') setRightActive(paths[0])
    else setLeftActive(paths[0])
    setFocusedPanel(target)
    setSelectedPaths(new Set())
  }, [])

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
        next.has(path) ? next.delete(path) : next.add(path)
        return next
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFiles, selectedPaths])

  // ── activate tab ─────────────────────────────────────────────────────────────
  const activateFile = useCallback((path: string) => {
    const file = openFiles.find(f => f.path === path)
    if (!file) return
    if (file.panel === 'left') setLeftActive(path)
    else setRightActive(path)
    setFocusedPanel(file.panel)
    setSelectedPaths(new Set())
  }, [openFiles])

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
    const path  = panel === 'left' ? leftActiveRef.current : rightActiveRef.current
    if (!path) return
    const editor = panel === 'left' ? leftEditorRef.current : rightEditorRef.current
    if (!editor) return
    await ExplorerSaveFile(path, editor.getValue())
    setOpenFiles(prev => prev.map(f => f.path === path ? { ...f, dirty: false } : f))
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveFile() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [saveFile])

  // ── editor change ─────────────────────────────────────────────────────────────
  const leftOnChange = useCallback((value: string | undefined) => {
    if (value === undefined) return
    const path = leftActiveRef.current
    if (!path) return
    setOpenFiles(prev => prev.map(f =>
      f.path === path ? { ...f, content: value, dirty: true, pinned: true } : f
    ))
  }, [])

  const rightOnChange = useCallback((value: string | undefined) => {
    if (value === undefined) return
    const path = rightActiveRef.current
    if (!path) return
    setOpenFiles(prev => prev.map(f =>
      f.path === path ? { ...f, content: value, dirty: true, pinned: true } : f
    ))
  }, [])

  // ── editor mount factory ──────────────────────────────────────────────────────
  const setupEditor = (editor: any, monaco: any, panel: 'left' | 'right') => {
    editor.onDidFocusEditorText(() => {
      setFocusedPanel(panel)
      focusedPanelRef.current = panel
    })

    editor.onDidChangeCursorPosition((e: any) => {
      setStatusLine({ line: e.position.lineNumber, col: e.position.column })
    })

    const syncModel = () => {
      const model = editor.getModel()
      if (!model) return
      setLineEnding(model.getEOL() === '\r\n' ? 'CRLF' : 'LF')
      setTotalLines(model.getLineCount())
      setTabSize(editor.getOption(monaco.editor.EditorOption.tabSize))
    }
    syncModel()
    editor.onDidChangeModel(syncModel)
    editor.onDidChangeModelContent(() => {
      setTotalLines(editor.getModel()?.getLineCount() ?? 0)
    })

    const dom = editor.getDomNode()
    if (dom) {
      dom.addEventListener('wheel', (e: WheelEvent) => {
        if (!e.ctrlKey) return
        e.preventDefault()
        const cur  = editor.getOption(monaco.editor.EditorOption.fontSize)
        const next = e.deltaY < 0 ? Math.min(cur + 1, 36) : Math.max(cur - 1, 8)
        setFontSize(next)
        editor.updateOptions({ fontSize: next })
      }, { passive: false })
    }
  }

  const onLeftMount = useCallback((editor: any, monaco: any) => {
    leftEditorRef.current  = editor
    leftMonacoRef.current  = monaco
    setupEditor(editor, monaco, 'left')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onRightMount = useCallback((editor: any, monaco: any) => {
    rightEditorRef.current  = editor
    rightMonacoRef.current  = monaco
    setupEditor(editor, monaco, 'right')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  // ── Monaco options object (shared across both editors) ────────────────────────
  const monacoOptions = useMemo(() => ({
    fontSize,
    fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Menlo, Monaco, 'Courier New', monospace",
    fontLigatures: true,
    minimap: { enabled: minimap },
    scrollBeyondLastLine: false,
    lineNumbers: 'on' as const,
    renderLineHighlight: 'line' as const,
    wordWrap: (wordWrap ? 'on' : 'off') as 'on' | 'off',
    tabSize: 2,
    padding: { top: 8 },
    smoothScrolling: true,
    folding: true,
    bracketPairColorization: { enabled: true },
    guides: {
      indentation: indentGuides,
      bracketPairs: indentGuides,
      bracketPairsHorizontal: indentGuides,
      highlightActiveIndentation: indentGuides,
    },
  }), [fontSize, minimap, wordWrap, indentGuides])

  const beforeMount = useCallback((monaco: any) => {
    if (theme.monacoThemeDef) {
      monaco.editor.defineTheme(theme.monacoThemeId, theme.monacoThemeDef as any)
    }
  }, [theme])

  // ── render helpers ────────────────────────────────────────────────────────────
  const leftFileObj  = openFiles.find(f => f.path === leftActive)
  const rightFileObj = openFiles.find(f => f.path === rightActive)

  const renderMonaco = (
    fileObj: OpenFile | undefined,
    onChange: (v: string | undefined) => void,
    onMount: (editor: any, monaco: any) => void,
    isFocused: boolean,
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
    return (
      <MonacoEditor
        key={fileObj.path}
        value={fileObj.content}
        language={fileObj.language}
        theme={theme.monacoThemeId}
        beforeMount={beforeMount}
        loading={<div style={{ width: '100%', height: '100%', background: 'var(--ide-editor-bg)' }} />}
        onChange={onChange}
        onMount={onMount}
        options={monacoOptions}
      />
    )
  }

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
            {renderMonaco(leftFileObj, leftOnChange, onLeftMount, focusedPanel === 'left')}
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
                {renderMonaco(rightFileObj, rightOnChange, onRightMount, focusedPanel === 'right')}
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
            <span className="ide-statusbar__segment ide-statusbar__segment--right">{lineEnding}</span>
            <span className="ide-statusbar__segment ide-statusbar__segment--right">Spaces: {tabSize}</span>
            <span className="ide-statusbar__segment ide-statusbar__segment--right">{activeFileObj.language}</span>
            <span className="ide-statusbar__segment ide-statusbar__segment--right">
              Ln {statusLine.line}/{totalLines}  Col {statusLine.col}
            </span>
          </>
        )}
      </div>
    </div>
  )

  // ── explorer divider ──────────────────────────────────────────────────────────
  const explorerDivider = <div className="ide-divider" onMouseDown={onExplorerDividerDown} />

  return (
    <div className="ide-root" style={themeVars}>
      {explorerPos === 'left'
        ? <>{explorerPanel}{explorerDivider}{editorArea}</>
        : <>{editorArea}{explorerDivider}{explorerPanel}</>
      }
    </div>
  )
}
