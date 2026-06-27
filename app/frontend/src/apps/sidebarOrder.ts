// User-customizable sidebar ordering for installed apps, split into a
// "visible" row and an "overflow" (more menu) list. Mirrors registry.ts's
// persistence pattern: localStorage is a synchronous read-through cache,
// config.json (via the generic config.get/config.set IPC) is the source of
// truth.
//
// Newly-installed apps default into "visible" until MAX_VISIBLE_DEFAULT is
// reached, after which they default into "overflow" -- but that default only
// governs automatic placement. Once a user drags an app between lists or
// reorders it, their arrangement is authoritative: dragging an 8th app into
// the visible row is exactly how you end up with more than 7 visible icons.
import { useEffect, useState } from 'react'
import { invoke, isWebViewHost } from '../lib/ipc'

export const MAX_VISIBLE_DEFAULT = 7

const KEY = 'binder:apps:sidebarOrder'
const EVENT = 'binder:sidebar-order-changed'

export interface SidebarOrderState {
  visible: string[]
  overflow: string[]
}

function readCache(): SidebarOrderState {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (raw && Array.isArray(raw.visible) && Array.isArray(raw.overflow)) {
      return { visible: raw.visible, overflow: raw.overflow }
    }
  } catch { /* ignore */ }
  return { visible: [], overflow: [] }
}

let state: SidebarOrderState = readCache()

function sameOrder(a: SidebarOrderState, b: SidebarOrderState): boolean {
  return a.visible.length === b.visible.length && a.overflow.length === b.overflow.length &&
    a.visible.every((id, i) => id === b.visible[i]) && a.overflow.every((id, i) => id === b.overflow[i])
}

function writeState(next: SidebarOrderState): void {
  if (sameOrder(state, next)) return
  state = next
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(EVENT))
  if (isWebViewHost()) {
    void invoke('config.set', { key: 'sidebar_app_order', value: next }).catch(() => {})
  }
}

/** Reads sidebar_app_order from config.json and hydrates the local cache. Call once at startup. */
export async function hydrateSidebarOrder(): Promise<void> {
  if (!isWebViewHost()) return
  try {
    const data = await invoke<{ sidebar_app_order?: SidebarOrderState }>('config.get')
    const stored = data.sidebar_app_order
    if (stored && Array.isArray(stored.visible) && Array.isArray(stored.overflow)) {
      state = stored
      try { localStorage.setItem(KEY, JSON.stringify(stored)) } catch { /* ignore */ }
      window.dispatchEvent(new CustomEvent(EVENT))
    }
  } catch { /* keep whatever was cached */ }
}

export function getSidebarOrder(): SidebarOrderState { return state }

export function onSidebarOrderChanged(handler: () => void): () => void {
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}

/**
 * Drops ids no longer installed and appends newly-installed ids that aren't
 * tracked yet (visible while there's room under the default cap, else
 * overflow). `defaultOrder` should be the manifest-declared default order
 * (used only the first time an id is seen).
 */
export function reconcileSidebarOrder(installedIds: string[], defaultOrder?: string[]): void {
  const installed = new Set(installedIds)
  const visible  = state.visible.filter(id => installed.has(id))
  const overflow = state.overflow.filter(id => installed.has(id))
  const known = new Set([...visible, ...overflow])

  const newIds = installedIds.filter(id => !known.has(id))
  if (defaultOrder) {
    const rank = new Map(defaultOrder.map((id, i) => [id, i]))
    newIds.sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0))
  }
  for (const id of newIds) {
    if (visible.length < MAX_VISIBLE_DEFAULT) visible.push(id)
    else overflow.push(id)
  }

  writeState({ visible, overflow })
}

function moveWithinList(list: string[], fromId: string, toIndex: number): string[] {
  const next = list.filter(id => id !== fromId)
  const clamped = Math.max(0, Math.min(toIndex, next.length))
  next.splice(clamped, 0, fromId)
  return next
}

/** Reorder `id` to `toIndex` within whichever list (visible/overflow) it's currently in. */
export function reorderSidebarApp(id: string, toIndex: number): void {
  if (state.visible.includes(id)) {
    writeState({ visible: moveWithinList(state.visible, id, toIndex), overflow: state.overflow })
  } else if (state.overflow.includes(id)) {
    writeState({ visible: state.visible, overflow: moveWithinList(state.overflow, id, toIndex) })
  }
}

/** Move `id` into `target` list at `toIndex` (use for dragging across visible <-> overflow). */
export function moveSidebarAppToList(id: string, target: 'visible' | 'overflow', toIndex: number): void {
  const visible  = state.visible.filter(i => i !== id)
  const overflow = state.overflow.filter(i => i !== id)
  if (target === 'visible') {
    visible.splice(Math.max(0, Math.min(toIndex, visible.length)), 0, id)
  } else {
    overflow.splice(Math.max(0, Math.min(toIndex, overflow.length)), 0, id)
  }
  writeState({ visible, overflow })
}

export function useSidebarOrder(): SidebarOrderState {
  const [order, setOrder] = useState(state)
  useEffect(() => onSidebarOrderChanged(() => setOrder(getSidebarOrder())), [])
  return order
}
