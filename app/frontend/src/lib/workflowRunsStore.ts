// Global workflow-run store.
//
// Workflow runs are started here (not inside WorkflowsPanel) so that a run
// keeps streaming output/events and stays visible (via WorkflowRunToasts)
// no matter which page or pane the user navigates to.

import { useSyncExternalStore } from 'react'
import { workflows, type WorkflowStepEvent } from './workflows'
import { on, off } from './ipc'

export type WorkflowRunStatus = 'running' | 'success' | 'failure'
export type WorkflowDownloadState = 'idle' | 'downloading' | 'downloaded'

export interface WorkflowRunRecord {
  runId:         string
  cwd:           string
  file:          string
  name:          string
  status:        WorkflowRunStatus
  exitCode:      number | null
  output:        string
  stepEvents:    WorkflowStepEvent[]
  startedAt:     number
  finishedAt:    number | null
  downloadState: WorkflowDownloadState
  dismissed:     boolean
}

// Strip ANSI escape sequences for plain-text display / log download.
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '')
}

const runs = new Map<string, WorkflowRunRecord>()
let snapshot: WorkflowRunRecord[] = []
const listeners = new Set<() => void>()

function commit() {
  snapshot = Array.from(runs.values())
  listeners.forEach(l => l())
}

function update(runId: string, patch: Partial<WorkflowRunRecord>) {
  const cur = runs.get(runId)
  if (!cur) return
  runs.set(runId, { ...cur, ...patch })
  commit()
}

export function subscribeWorkflowRuns(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getWorkflowRunsSnapshot(): WorkflowRunRecord[] {
  return snapshot
}

export function useWorkflowRuns(): WorkflowRunRecord[] {
  return useSyncExternalStore(subscribeWorkflowRuns, getWorkflowRunsSnapshot, getWorkflowRunsSnapshot)
}

/** Start a workflow run and track it globally. Returns the new run's id. */
export function startWorkflowRun(cwd: string, file: string, name: string): string {
  const runId = crypto.randomUUID()
  const record: WorkflowRunRecord = {
    runId, cwd, file, name,
    status: 'running', exitCode: null, output: '',
    stepEvents: [], startedAt: Date.now(), finishedAt: null,
    downloadState: 'idle', dismissed: false,
  }
  runs.set(runId, record)
  commit()

  const onOutput = (data: unknown) => {
    const cur = runs.get(runId)
    if (!cur) return
    update(runId, { output: cur.output + stripAnsi(String(data)) })
  }
  const onStep = (data: unknown) => {
    const cur = runs.get(runId)
    if (!cur) return
    const ev = data as WorkflowStepEvent
    const steps = cur.stepEvents.slice()
    const idx = steps.findIndex(s => s.job === ev.job && s.stepIndex === ev.stepIndex)
    if (idx >= 0) steps[idx] = ev
    else steps.push(ev)
    update(runId, { stepEvents: steps })
  }
  const cleanup = () => {
    off(`workflows:output:${runId}`, onOutput)
    off(`workflows:done:${runId}`, onDone)
    off(`workflows:step:${runId}`, onStep)
  }
  function onDone(data: unknown) {
    const code = (data as { code?: number })?.code ?? null
    cleanup()
    update(runId, { exitCode: code, status: code === 0 ? 'success' : 'failure', finishedAt: Date.now() })
  }

  on(`workflows:output:${runId}`, onOutput)
  on(`workflows:done:${runId}`, onDone)
  on(`workflows:step:${runId}`, onStep)

  workflows.run(cwd, file, runId).catch((e: any) => {
    cleanup()
    const cur = runs.get(runId)
    update(runId, {
      output:     (cur?.output ?? '') + `\nerror: ${e?.message ?? 'failed to start run'}\n`,
      status:     'failure',
      exitCode:   -1,
      finishedAt: Date.now(),
    })
  })

  return runId
}

export function stopWorkflowRun(runId: string): void {
  const cur = runs.get(runId)
  if (cur?.status !== 'running') return
  workflows.stop(runId).catch(() => {})
}

export function dismissWorkflowRun(runId: string): void {
  update(runId, { dismissed: true })
}

/** Download the run's accumulated output as a .log file. */
export async function downloadWorkflowRunLog(runId: string): Promise<void> {
  const cur = runs.get(runId)
  if (cur?.downloadState !== 'idle') return
  update(runId, { downloadState: 'downloading' })

  try {
    const blob = new Blob([cur.output], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const safeName = cur.name.replace(/[^a-z0-9_-]+/gi, '_')
    const a = document.createElement('a')
    a.href = url
    a.download = `${safeName}-${cur.runId.slice(0, 8)}.log`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    // Brief delay so the "downloading" state is visible before "downloaded".
    await new Promise(res => setTimeout(res, 700))
    update(runId, { downloadState: 'downloaded' })
  } catch {
    update(runId, { downloadState: 'idle' })
  }
}
