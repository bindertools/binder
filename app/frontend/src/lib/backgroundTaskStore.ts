import { useSyncExternalStore } from 'react'

export interface BackgroundTask {
  id: string
  label: string
  startedAt: number
}

export interface BackgroundTaskSnapshot {
  tasks: BackgroundTask[]
  batchTotal: number
  completedInBatch: number
  shown: boolean
}

let activeTasks: BackgroundTask[] = []
let batchTotal = 0
let completedInBatch = 0
let shown = false
let hideTimer: ReturnType<typeof setTimeout> | null = null

let snapshot: BackgroundTaskSnapshot = { tasks: [], batchTotal: 0, completedInBatch: 0, shown: false }
const listeners = new Set<() => void>()

function emit() {
  snapshot = { tasks: activeTasks, batchTotal, completedInBatch, shown }
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
  if (hideTimer !== null) {
    clearTimeout(hideTimer)
    hideTimer = null
  }

  const id = crypto.randomUUID()

  if (!shown) {
    batchTotal = 0
    completedInBatch = 0
    shown = true
  }

  batchTotal++
  activeTasks = [...activeTasks, { id, label, startedAt: Date.now() }]
  emit()
  return id
}

export function removeBackgroundTask(id: string): void {
  if (!activeTasks.some(t => t.id === id)) return
  activeTasks = activeTasks.filter(t => t.id !== id)
  completedInBatch++

  if (activeTasks.length === 0) {
    hideTimer = setTimeout(() => {
      hideTimer = null
      shown = false
      batchTotal = 0
      completedInBatch = 0
      emit()
    }, 5000)
  }

  emit()
}
