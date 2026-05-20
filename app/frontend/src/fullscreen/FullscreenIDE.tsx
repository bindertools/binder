import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import MonacoEditor from '@monaco-editor/react'
import { EventsOn, EventsOff } from '../../wailsjs/runtime/runtime'
import { ExplorerOpen, ExplorerGetFile, ExplorerSaveFile } from '../../wailsjs/go/main/App'
import FileExplorer, { FileNode } from './FileExplorer'
import type { AppTheme } from '../themes'
import './fullscreen.css'

interface OpenFile {
  path: string
  name: string
  content: string
  dirty: boolean
  language: string
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

export default function FullscreenIDE({ cwd, theme, indentGuides, minimap, wordWrap, defaultZoom }: Props) {
  const [tree,        setTree]        = useState<FileNode | null>(null)
  const [openFiles,   setOpenFiles]   = useState<OpenFile[]>([])
  const [activeFile,  setActiveFile]  = useState<string | null>(null)
  const [explorerW,   setExplorerW]   = useState(220)
  const [explorerPos, setExplorerPos] = useState<'left' | 'right'>('left')
  const [collapsed,   setCollapsed]   = useState(false)
  const [statusLine,  setStatusLine]  = useState({ line: 1, col: 1 })
  const [lineEnding,  setLineEnding]  = useState<'CRLF' | 'LF'>('LF')
  const [tabSize,     setTabSize]     = useState(2)
  const [totalLines,  setTotalLines]  = useState(0)
  const [fontSize,    setFontSize]    = useState(() => Math.round(13 * defaultZoom))

  const draggingDiv = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef   = useRef<any>(null)
  const monacoRef   = useRef<any>(null)

  // ── derive CSS vars from app theme ───────────────────────────────────────────
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

  // ── sync font size when zoom config changes ──────────────────────────────────
  useEffect(() => {
    const next = Math.round(13 * defaultZoom)
    setFontSize(next)
    editorRef.current?.updateOptions({ fontSize: next })
  }, [defaultZoom])

  // ── sync editor options when config flags change ─────────────────────────────
  useEffect(() => {
    if (!editorRef.current || !monacoRef.current) return
    editorRef.current.updateOptions({
      minimap: { enabled: minimap },
      wordWrap: wordWrap ? 'on' : 'off',
      guides: {
        indentation: indentGuides,
        bracketPairs: indentGuides,
        bracketPairsHorizontal: indentGuides,
        highlightActiveIndentation: indentGuides,
      },
    })
  }, [minimap, wordWrap, indentGuides])

  // ── load tree ────────────────────────────────────────────────────────────────
  const loadTree = useCallback(async () => {
    if (!cwd) return
    const root = await ExplorerOpen(cwd)
    setTree(root as FileNode)
  }, [cwd])

  useEffect(() => { loadTree() }, [loadTree])

  // ── real-time watcher updates ────────────────────────────────────────────────
  useEffect(() => {
    EventsOn('fullscreen:tree', (node: FileNode) => setTree(node))
    return () => EventsOff('fullscreen:tree')
  }, [])

  // ── open a file ──────────────────────────────────────────────────────────────
  const openFile = useCallback(async (node: FileNode) => {
    if (node.isDir) return
    const already = openFiles.find(f => f.path === node.path)
    if (already) { setActiveFile(node.path); return }
    try {
      const content = await ExplorerGetFile(node.path)
      setOpenFiles(prev => [...prev, {
        path: node.path,
        name: node.name,
        content,
        dirty: false,
        language: langFromExt(node.ext),
      }])
      setActiveFile(node.path)
    } catch { /* permission error etc */ }
  }, [openFiles])

  // ── save active file ─────────────────────────────────────────────────────────
  const saveFile = useCallback(async () => {
    const file = openFiles.find(f => f.path === activeFile)
    if (!file) return
    await ExplorerSaveFile(file.path, file.content)
    setOpenFiles(prev => prev.map(f => f.path === file.path ? { ...f, dirty: false } : f))
  }, [openFiles, activeFile])

  // Ctrl+S
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveFile() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [saveFile])

  // ── close tab ────────────────────────────────────────────────────────────────
  const closeTab = useCallback((path: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setOpenFiles(prev => {
      const next = prev.filter(f => f.path !== path)
      if (activeFile === path) setActiveFile(next.length ? next[next.length - 1].path : null)
      return next
    })
  }, [activeFile])

  // ── editor change ────────────────────────────────────────────────────────────
  const onEditorChange = useCallback((value: string | undefined) => {
    if (!activeFile || value === undefined) return
    setOpenFiles(prev => prev.map(f =>
      f.path === activeFile ? { ...f, content: value, dirty: true } : f
    ))
  }, [activeFile])

  // ── editor mount ─────────────────────────────────────────────────────────────
  const onEditorMount = useCallback((editor: any, monaco: any) => {
    editorRef.current  = editor
    monacoRef.current  = monaco

    editor.onDidChangeCursorPosition((e: any) => {
      setStatusLine({ line: e.position.lineNumber, col: e.position.column })
    })

    const syncModelInfo = () => {
      const model = editor.getModel()
      if (!model) return
      setLineEnding(model.getEOL() === '\r\n' ? 'CRLF' : 'LF')
      setTotalLines(model.getLineCount())
      setTabSize(editor.getOption(monaco.editor.EditorOption.tabSize))
    }
    syncModelInfo()
    editor.onDidChangeModel(syncModelInfo)
    editor.onDidChangeModelContent(() => {
      setTotalLines(editor.getModel()?.getLineCount() ?? 0)
    })

    // Ctrl+Wheel zoom
    const domNode = editor.getDomNode()
    if (domNode) {
      domNode.addEventListener('wheel', (e: WheelEvent) => {
        if (!e.ctrlKey) return
        e.preventDefault()
        const current = editor.getOption(monaco.editor.EditorOption.fontSize)
        const next = e.deltaY < 0 ? Math.min(current + 1, 36) : Math.max(current - 1, 8)
        setFontSize(next)
        editor.updateOptions({ fontSize: next })
      }, { passive: false })
    }
  }, [])

  // ── explorer resize drag ─────────────────────────────────────────────────────
  const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    draggingDiv.current = true
    const startX = e.clientX
    const startW = explorerW

    const onMove = (ev: MouseEvent) => {
      if (!draggingDiv.current) return
      const delta = explorerPos === 'left' ? ev.clientX - startX : startX - ev.clientX
      setExplorerW(Math.max(140, Math.min(480, startW + delta)))
    }
    const onUp = () => {
      draggingDiv.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [explorerW, explorerPos])

  const activeFileObj = openFiles.find(f => f.path === activeFile)

  // ── explorer panel ───────────────────────────────────────────────────────────
  const explorerPanel = (
    <div
      className={`ide-explorer${collapsed ? ' ide-explorer--collapsed' : ''}`}
      style={{ width: collapsed ? 36 : explorerW }}
    >
      {collapsed ? (
        <button className="ide-explorer__expand-btn" onClick={() => setCollapsed(false)} title="Expand explorer">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M6 2l6 6-6 6V2z"/>
          </svg>
        </button>
      ) : (
        <>
          <div className="ide-explorer__toolbar">
            <span className="ide-explorer__title">Explorer</span>
            <div className="ide-explorer__actions">
              <button title="Move explorer to right" onClick={() => setExplorerPos(p => p === 'left' ? 'right' : 'left')}>
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M3 2h10a1 1 0 011 1v10a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1zm7 1H3v10h7V3zm1 0v10h2V3h-2z"/>
                </svg>
              </button>
              <button title="Collapse explorer" onClick={() => setCollapsed(true)}>
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M10 2L4 8l6 6V2z"/>
                </svg>
              </button>
            </div>
          </div>
          <FileExplorer
            root={tree}
            selectedPath={activeFile ?? ''}
            onSelect={openFile}
            onRefresh={loadTree}
          />
        </>
      )}
    </div>
  )

  const divider = (
    <div className="ide-divider" onMouseDown={onDividerMouseDown} />
  )

  // ── editor panel ─────────────────────────────────────────────────────────────
  const editorPanel = (
    <div className="ide-editor-area">
      {/* Tabs */}
      <div className="ide-tabs">
        {openFiles.map(f => (
          <div
            key={f.path}
            className={`ide-tab${f.path === activeFile ? ' ide-tab--active' : ''}`}
            onClick={() => setActiveFile(f.path)}
            title={f.path}
          >
            <span className="ide-tab__name">{f.name}</span>
            {f.dirty && <span className="ide-tab__dot" />}
            <button
              className="ide-tab__close"
              onMouseDown={e => closeTab(f.path, e)}
              title="Close"
            >x</button>
          </div>
        ))}
        {openFiles.length === 0 && (
          <div className="ide-tabs__empty">No files open</div>
        )}
      </div>

      {/* Editor */}
      <div className="ide-editor">
        {activeFileObj ? (
          <MonacoEditor
            key={activeFileObj.path}
            value={activeFileObj.content}
            language={activeFileObj.language}
            theme={theme.monacoThemeId}
            beforeMount={monaco => {
              if (theme.monacoThemeDef) {
                monaco.editor.defineTheme(theme.monacoThemeId, theme.monacoThemeDef as any)
              }
            }}
            loading={<div style={{ width: '100%', height: '100%', background: 'var(--ide-editor-bg)' }} />}
            onChange={onEditorChange}
            onMount={onEditorMount}
            options={{
              fontSize,
              fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Menlo, Monaco, 'Courier New', monospace",
              fontLigatures: true,
              minimap: { enabled: minimap },
              scrollBeyondLastLine: false,
              lineNumbers: 'on',
              renderLineHighlight: 'line',
              wordWrap: wordWrap ? 'on' : 'off',
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
            }}
          />
        ) : (
          <div className="ide-editor__empty">
            <div className="ide-editor__empty-hint">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
                <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/>
                <polyline points="13 2 13 9 20 9"/>
              </svg>
              <p>Select a file to open</p>
            </div>
          </div>
        )}
      </div>

      {/* Status bar */}
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

  return (
    <div className="ide-root" ref={containerRef} style={themeVars}>
      {explorerPos === 'left' ? (
        <>{explorerPanel}{divider}{editorPanel}</>
      ) : (
        <>{editorPanel}{divider}{explorerPanel}</>
      )}
    </div>
  )
}
