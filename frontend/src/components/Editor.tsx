import React, { useRef, useCallback, useState, useMemo } from 'react'
import MonacoEditor, { OnMount, BeforeMount } from '@monaco-editor/react'
import { WriteFile } from '../../wailsjs/go/main/App'
import type * as Monaco from 'monaco-editor'

interface Props {
  tabId: string
  filePath: string
  content: string
  language: string
  active: boolean
  indentGuides: boolean
}

export default function Editor({ tabId, filePath, content, language, active, indentGuides }: Props) {
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [fontSize, setFontSize] = useState(13)

  const beforeMount: BeforeMount = (monaco) => {
    monaco.languages.registerCompletionItemProvider('plaintext', {
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position)
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        }
        const words = [...new Set(model.getValue().match(/\b\w{3,}\b/g) || [])]
        return {
          suggestions: words.map(w => ({
            label: w,
            kind: monaco.languages.CompletionItemKind.Text,
            insertText: w,
            range,
          })),
        }
      },
    })
  }

  // Memoised so the options reference only changes when fontSize changes.
  // This prevents @monaco-editor/react from calling updateOptions on every re-render
  // (e.g. when the `active` prop flips), which would reset the zoom level.
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
    minimap: { enabled: false },
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
      indentation: indentGuides,
      bracketPairs: indentGuides,
      bracketPairsHorizontal: indentGuides,
      highlightActiveIndentation: indentGuides,
    },
  }), [fontSize, indentGuides])

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

  return (
    <div className="editor-container">
      <div className="editor-filepath">{filePath}</div>
      <MonacoEditor
        height="calc(100% - 24px)"
        language={language}
        defaultValue={content}
        theme="vs-dark"
        beforeMount={beforeMount}
        onMount={onMount}
        options={editorOptions}
      />
    </div>
  )
}
