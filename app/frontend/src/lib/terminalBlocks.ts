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
