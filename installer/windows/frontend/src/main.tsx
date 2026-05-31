import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './App.css'
import { isWebViewHost } from './lib/ipc'

// Inject Wails shim in C++ installer mode
if (isWebViewHost()) {
  await import('./lib/wails-shim')
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
