export type CommandBlockStatus = 'running' | 'success' | 'background' | 'error'

export interface CommandBlock {
  id: string
  command: string
  cwd: string
  branch: string
  ts: string
  outputRaw: string
  status: CommandBlockStatus
  exitCode: number | null
}

// Heuristic: a command that detaches and returns immediately (trailing `&`,
// or an explicit `start`/Start-Process launch) is treated as "starting a
// background runtime" rather than a normal foreground command.
export function isBackgroundCommand(cmd: string): boolean {
  const trimmed = cmd.trim()
  if (/(?<!&)&\s*$/.test(trimmed)) return true
  return /^(start|start-process)\b/i.test(trimmed)
}

export function deriveStatus(exitCode: number, background: boolean): CommandBlockStatus {
  if (exitCode !== 0) return 'error'
  return background ? 'background' : 'success'
}

// Heuristic: a still-running command (e.g. a dev server) whose output
// contains one of these signals has finished starting up and is now serving
// — show it the same as a backgrounded process (green dot) even though it
// hasn't exited and is still holding the terminal.
const READY_PATTERNS: RegExp[] = [
  /ready in \d/i,
  /compiled successfully/i,
  /webpack compiled/i,
  /listening on/i,
  /server (is )?running/i,
  /started server on/i,
  /local:\s*https?:\/\//i,
  /https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)[:/]/i,
  /watching for file changes/i,
]

export function isRuntimeReady(output: string): boolean {
  return READY_PATTERNS.some(p => p.test(output))
}
