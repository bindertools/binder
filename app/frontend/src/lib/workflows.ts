import { invoke } from './ipc'

function textToB64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binStr = ''
  for (let i = 0; i < bytes.length; i++) binStr += String.fromCharCode(bytes[i])
  return btoa(binStr)
}

export interface WorkflowLastCommit {
  hash:    string
  author:  string
  date:    string
  message: string
}

export interface WorkflowFile {
  file:       string
  path:       string
  name:       string
  triggers:   string[]
  lastCommit: WorkflowLastCommit | null
}

export interface WorkflowContent {
  content:  string
  language: string
}

export interface RunnerStatus {
  bash: { available: boolean; path: string }
  git:  { available: boolean; version: string }
  pwsh: { available: boolean }
}

export interface WorkflowStepEvent {
  job:       string
  jobName:   string
  stepIndex: number
  stepName:  string
  status:    'running' | 'success' | 'failure' | 'skipped'
}

export const workflows = {
  list: (path: string) =>
    invoke<{ workflows: WorkflowFile[] }>('workflows.list', { path }),

  read: (path: string, file: string) =>
    invoke<WorkflowContent>('workflows.read', { path, file }),

  /** Writes the full YAML content back to a workflow file at an absolute
   *  path — used by the Events Map's add-process/link/condition editing,
   *  which goes through the same generic file-write IPC the code editor
   *  uses rather than a workflows-specific endpoint. */
  write: (absPath: string, content: string) =>
    invoke<{ ok: boolean }>('fs.writefile', { path: absPath, content: textToB64(content) }),

  checkRunner: () =>
    invoke<RunnerStatus>('workflows.checkRunner', {}),

  run: (path: string, file: string, runId: string) =>
    invoke<boolean>('workflows.run', { path, file, runId }),

  stop: (runId: string) =>
    invoke<boolean>('workflows.stop', { runId }),
}
