// Typed wrappers around the C++ → JS push events.
// Re-exports on/off from ipc.ts with typed callback signatures.
export { on, off } from './ipc'

// ── Event payload types ───────────────────────────────────────────────────────

export interface TerminalOutputEvent {
  id: string   // terminal session ID
  data: string // base64-encoded output chunk
}

export interface TerminalExitEvent {
  id: string
  code: number
}

export interface InstallProgressEvent {
  pct: number  // 0–100
  msg: string
}

export interface PerfUpdateEvent {
  cpu: number      // 0–100 percent
  memUsed: number  // bytes
  memTotal: number // bytes
}

export interface WindowResizeEvent {
  width: number
  height: number
}
