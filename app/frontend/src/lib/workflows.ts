import { invoke } from './ipc'

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

export interface ActStatus {
  installed: boolean
  version:   string
}

export const workflows = {
  list: (path: string) =>
    invoke<{ workflows: WorkflowFile[] }>('workflows.list', { path }),

  read: (path: string, file: string) =>
    invoke<WorkflowContent>('workflows.read', { path, file }),

  checkAct: () =>
    invoke<ActStatus>('workflows.checkAct', {}),

  run: (path: string, file: string, runId: string) =>
    invoke<boolean>('workflows.run', { path, file, runId }),

  stop: (runId: string) =>
    invoke<boolean>('workflows.stop', { runId }),
}
