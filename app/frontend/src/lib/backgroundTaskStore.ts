import { useSyncExternalStore } from 'react'

export interface BackgroundTask {
  id: string
  label: string
  startedAt: number
}

export interface CompletedTask {
  id: string
  label: string
  completedAt: number
}

export interface BackgroundTaskSnapshot {
  tasks: BackgroundTask[]
  completedTasks: CompletedTask[]
  batchTotal: number
  completedInBatch: number
  textShown: boolean
}

const MAX_COMPLETED_HISTORY = 20
const TEXT_HIDE_DELAY = 7000

let activeTasks: BackgroundTask[] = []
let completedTasks: CompletedTask[] = []
let batchTotal = 0
let completedInBatch = 0
let textShown = false
let hideTextTimer: ReturnType<typeof setTimeout> | null = null

let snapshot: BackgroundTaskSnapshot = { tasks: [], completedTasks: [], batchTotal: 0, completedInBatch: 0, textShown: false }
const listeners = new Set<() => void>()

function emit() {
  snapshot = { tasks: activeTasks, completedTasks, batchTotal, completedInBatch, textShown }
  listeners.forEach(l => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function getSnapshot(): BackgroundTaskSnapshot {
  return snapshot
}

export function useBackgroundTaskStore(): BackgroundTaskSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function addBackgroundTask(label: string): string {
  if (hideTextTimer !== null) {
    clearTimeout(hideTextTimer)
    hideTextTimer = null
  }

  const id = crypto.randomUUID()

  if (!textShown) {
    batchTotal = 0
    completedInBatch = 0
    textShown = true
  }

  batchTotal++
  activeTasks = [...activeTasks, { id, label, startedAt: Date.now() }]
  emit()
  return id
}

export function removeBackgroundTask(id: string): void {
  const task = activeTasks.find(t => t.id === id)
  if (!task) return

  activeTasks = activeTasks.filter(t => t.id !== id)
  completedInBatch++

  completedTasks = [
    { id: task.id, label: task.label, completedAt: Date.now() },
    ...completedTasks,
  ].slice(0, MAX_COMPLETED_HISTORY)

  if (activeTasks.length === 0) {
    hideTextTimer = setTimeout(() => {
      hideTextTimer = null
      textShown = false
      batchTotal = 0
      completedInBatch = 0
      emit()
    }, TEXT_HIDE_DELAY)
  }

  emit()
}
