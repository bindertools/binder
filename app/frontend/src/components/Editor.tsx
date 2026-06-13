import React, { useRef, useCallback, useState, useMemo, useEffect } from 'react'
import MonacoEditor, { OnMount, BeforeMount } from '@monaco-editor/react'
import { WriteFile } from '../../wailsjs/go/main/App'
import { THEMES, type GpuEditorColors } from '../themes'
import GpuEditor from './GpuEditor'
import type * as Monaco from 'monaco-editor'

interface Props {
  tabId:           string
  filePath:        string
  content:         string
  language:        string
  active:          boolean
  indentGuides:    boolean
  monacoTheme:     string
  monacoThemeDef?: Monaco.editor.IStandaloneThemeData
  minimap:         boolean
  defaultZoom?:    number
  gotoLine?:       number
  gpuColors?:      GpuEditorColors
}

// Module-level Monaco API reference so external callers can push theme updates
// the moment a custom theme definition changes while an editor is already mounted.
let _monacoApi: typeof Monaco | null = null
export function pushMonacoTheme(
  id:  string,
  def: Monaco.editor.IStandaloneThemeData,
): void {
  if (!_monacoApi) return
  _monacoApi.editor.defineTheme(id, def)
  _monacoApi.editor.setTheme(id)
}

export default function Editor({
  tabId: _tabId, filePath, content, language, active: _active,
  indentGuides, monacoTheme, monacoThemeDef, minimap,
  defaultZoom = 1, gotoLine, gpuColors,
}: Props) {
  const editorRef    = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const saveTimeout  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastGotoLine = useRef<number | undefined>(undefined)
  const [fontSize, setFontSize] = useState(() => Math.round(13 * defaultZoom))
  const [useGpuEditor, setUseGpuEditor] = useState(false)

  // Navigate to the requested line whenever gotoLine changes.
  useEffect(() => {
    if (!gotoLine || gotoLine === lastGotoLine.current) return
    lastGotoLine.current = gotoLine
    const editor = editorRef.current
    if (!editor) return
    editor.revealLineInCenter(gotoLine)
    editor.setPosition({ lineNumber: gotoLine, column: 1 })
    editor.focus()
  }, [gotoLine])

  // Dynamically re-register + re-apply the Monaco theme whenever the
  // definition changes (happens during live custom-theme preview).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!_monacoApi || !monacoThemeDef) return
    _monacoApi.editor.defineTheme(monacoTheme, monacoThemeDef)
    _monacoApi.editor.setTheme(monacoTheme)
  // JSON-stringify the def so the effect only fires on actual content changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monacoTheme, JSON.stringify(monacoThemeDef)])

  const beforeMount: BeforeMount = (monaco) => {
    _monacoApi = monaco

    // Register all known preset themes
    Object.entries(THEMES).forEach(([key, t]) => {
      if (t.monacoThemeDef) {
        monaco.editor.defineTheme(key, t.monacoThemeDef as Monaco.editor.IStandaloneThemeData)
      }
    })

    // Register any custom theme provided at mount time
    if (monacoThemeDef) {
      monaco.editor.defineTheme(monacoTheme, monacoThemeDef)
    }

    monaco.languages.registerCompletionItemProvider('plaintext', {
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position)
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber:   position.lineNumber,
          startColumn:     word.startColumn,
          endColumn:       word.endColumn,
        }
        const words = [...new Set(model.getValue().match(/\b\w{3,}\b/g) || [])]
        return {
          suggestions: words.map(w => ({
            label:      w,
            kind:       monaco.languages.CompletionItemKind.Text,
            insertText: w,
            range,
          })),
        }
      },
    })
  }

  // Memoised so the options reference only changes when these deps change.
  const editorOptions = useMemo<Monaco.editor.IStandaloneEditorConstructionOptions>(() => ({
    fontSize,
    fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Menlo, Monaco, 'Courier New', monospace",
    fontLigatures: true,
    lineNumbers: 'on',
    lineNumbersMinChars: 3,
    glyphMargin: false,
    folding: true,
    foldingHighlight: false,
    showFoldingControls: 'mouseover',
    minimap: { enabled: minimap },
    scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
    overviewRulerLanes: 0,
    hideCursorInOverviewRuler: true,
    renderLineHighlight: 'line',
    renderLineHighlightOnlyWhenFocus: false,
    suggestOnTriggerCharacters: true,
    quickSuggestions: { other: true, comments: false, strings: false },
    acceptSuggestionOnEnter: 'on',
    tabCompletion: 'on',
    wordBasedSuggestions: 'currentDocument',
    parameterHints: { enabled: true },
    autoClosingBrackets: 'languageDefined',
    autoClosingQuotes: 'languageDefined',
    formatOnPaste: true,
    formatOnType: false,
    padding: { top: 8, bottom: 8 },
    smoothScrolling: true,
    cursorBlinking: 'blink',
    cursorSmoothCaretAnimation: 'on',
    bracketPairColorization: { enabled: true },
    guides: {
      indentation:             indentGuides,
      bracketPairs:            indentGuides,
      bracketPairsHorizontal:  indentGuides,
      highlightActiveIndentation: indentGuides,
    },
  }), [fontSize, indentGuides, minimap])

  // When defaultZoom changes (config reload), update Monaco font size to match.
  useEffect(() => {
    const newSize = Math.round(13 * defaultZoom)
    setFontSize(newSize)
    editorRef.current?.updateOptions({ fontSize: newSize })
  }, [defaultZoom])

  const onMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor
    editor.focus()

    // Ctrl+S — immediate save
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      if (saveTimeout.current) clearTimeout(saveTimeout.current)
      WriteFile(filePath, editor.getValue()).catch(() => {})
    })

    // Ctrl+Wheel — zoom; read live from editor to avoid stale closure
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

    // Auto-save with 1s debounce
    editor.onDidChangeModelContent(() => {
      if (saveTimeout.current) clearTimeout(saveTimeout.current)
      saveTimeout.current = setTimeout(() => {
        WriteFile(filePath, editor.getValue()).catch(() => {})
      }, 1000)
    })
  }, [filePath])

  if (useGpuEditor) {
    return (
      <div className="flex-1 flex flex-col bg-[var(--app-bg)] overflow-hidden relative">
        <button
          className="absolute top-[2px] right-[8px] z-10 px-[8px] h-[20px] text-[10px] rounded-[4px] border border-[var(--border-color)] bg-[var(--info-bar-bg)] text-[var(--info-bar-color)] hover:text-[var(--info-bar-hover-color)] cursor-pointer"
          onClick={() => setUseGpuEditor(false)}
          title="Switch back to Monaco"
        >
          GPU editor (beta) — switch back
        </button>
        <GpuEditor filePath={filePath} fontSize={fontSize} colors={gpuColors} />
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col bg-[var(--app-bg)] overflow-hidden">
      <div className="px-[14px] text-[11px] text-[var(--info-bar-color)] bg-[var(--info-bar-bg)] border-b border-[var(--border-color)] font-mono whitespace-nowrap overflow-hidden text-ellipsis shrink-0 h-[26px] leading-[26px] flex items-center justify-between">
        <span>{filePath}</span>
        <button
          className="px-[8px] h-[18px] text-[10px] rounded-[4px] border border-[var(--border-color)] bg-transparent text-[var(--info-bar-color)] hover:text-[var(--info-bar-hover-color)] cursor-pointer shrink-0"
          onClick={() => setUseGpuEditor(true)}
          title="Try the in-house GPU-rendered editor"
        >
          GPU editor (beta)
        </button>
      </div>
      <MonacoEditor
        height="calc(100% - 24px)"
        language={language}
        defaultValue={content}
        theme={monacoTheme}
        beforeMount={beforeMount}
        onMount={onMount}
        options={editorOptions}
      />
    </div>
  )
}
