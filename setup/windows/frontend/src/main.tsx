import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './App.css'
import { isWebViewHost } from './lib/ipc'

// Wrap in async function so errors don't silently kill React mounting
async function mountApp() {
  if (isWebViewHost()) {
    try {
      await import('./lib/wails-shim')
    } catch (e) {
      // Log but don't block — fallback to proxy stubs
      console.error('[installer] Failed to load wails-shim:', e)
    }
  }
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}

mountApp().catch(err => {
  // Last-resort: render a plain error so the user sees something
  document.body.innerHTML = `<div style="color:white;padding:20px;font-family:sans-serif">
    <h2>Setup failed to load</h2><pre>${String(err)}</pre></div>`
})
