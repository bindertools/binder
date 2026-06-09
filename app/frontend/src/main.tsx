import React from 'react'
import ReactDOM from 'react-dom/client'
import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import App from './App'
import AppErrorBoundary from './components/AppErrorBoundary'
import './App.css'
import '../../themes/index.scss'
import { isWebViewHost, invoke } from './lib/ipc'

// Inject Wails compatibility shim so window.go.* routes through the C++ IPC.
// Must happen before React renders any components that call window.go.*.
if (isWebViewHost()) {
  await import('./lib/wails-shim')
}

// Expose React globally so plugin IIFE bundles can reference the host's React
// instance rather than bundling their own. This prevents "Invalid hook call"
// errors that occur when two separate React copies are in the same page.
;(window as any).React = React

// Configure Monaco to use local workers (no CDN — required for offline Wails app)
self.MonacoEnvironment = {
  getWorker(_: unknown, label: string) {
    if (label === 'json') return new jsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
    if (label === 'typescript' || label === 'javascript') return new tsWorker()
    return new editorWorker()
  },
}

loader.config({ monaco })

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement)
root.render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
)

// Signal the C++ host that the frontend has rendered (closes the splash screen)
if (isWebViewHost()) {
  // Use setTimeout(0) to ensure React has flushed the initial render
  setTimeout(() => {
    invoke('app.ready').catch(() => {})
  }, 0)
}
