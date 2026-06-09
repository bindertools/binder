import React from 'react'

interface State {
  error: Error | null
}

// Top-level safety net: if any uncaught error escapes a render, React 18
// unmounts the whole tree, leaving an empty #root and the html/body's
// #1c1c1e background — i.e. the app "goes gray" with no indication why.
// This boundary catches that and shows the error instead, with a reload
// button to recover without restarting the whole app.
export default class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[app] uncaught error', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          width: '100vw', height: '100vh', display: 'flex', alignItems: 'center',
          justifyContent: 'center', background: '#1c1c1e', color: '#e6e6e6',
          fontFamily: "'SF Pro Text', 'Segoe UI', system-ui, sans-serif", padding: 24,
        }}>
          <div style={{
            maxWidth: 720, width: '100%', border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 18, padding: 20, background: 'rgba(255,255,255,0.03)',
          }}>
            <div style={{ fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.6, marginBottom: 8 }}>
              cmdIDE crashed
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 10 }}>
              {this.state.error.message}
            </div>
            <pre style={{
              fontSize: 11, lineHeight: 1.6, opacity: 0.75, whiteSpace: 'pre-wrap',
              maxHeight: 240, overflow: 'auto', fontFamily: 'Menlo, Monaco, monospace', margin: 0,
            }}>
              {this.state.error.stack}
            </pre>
            <button
              onClick={() => window.location.reload()}
              style={{
                marginTop: 16, padding: '6px 14px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.18)',
                background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12,
              }}
            >
              Reload
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
