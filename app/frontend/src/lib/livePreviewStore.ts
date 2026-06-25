// Global live-preview store — mirrors workflowRunsStore's pattern so preview
// state survives navigating away from the Live Preview page and back (the
// page itself can now mount/unmount freely instead of needing to be an
// always-mounted overlay).
import { useSyncExternalStore } from 'react'

export interface LivePreviewEntry {
  key:   string   // file path (md/html) or remote URL — also the de-dup key
  type:  'markdown' | 'html' | 'url'
  src:   string    // content, local-server URL, or remote URL
  title: string
}

let previews: LivePreviewEntry[] = []
let activeKey: string | null = null
const listeners = new Set<() => void>()

function commit() {
  listeners.forEach(l => l())
}

export function subscribeLivePreviews(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getLivePreviewsSnapshot(): LivePreviewEntry[] { return previews }
export function getActiveLivePreviewKeySnapshot(): string | null { return activeKey }

export function useLivePreviews(): LivePreviewEntry[] {
  return useSyncExternalStore(subscribeLivePreviews, getLivePreviewsSnapshot, getLivePreviewsSnapshot)
}

export function useActiveLivePreviewKey(): string | null {
  return useSyncExternalStore(subscribeLivePreviews, getActiveLivePreviewKeySnapshot, getActiveLivePreviewKeySnapshot)
}

export interface OpenLivePreviewPayload {
  type: 'markdown' | 'html' | 'url'
  url?: string
  path?: string
  content?: string
}

export function openLivePreview(payload: OpenLivePreviewPayload): void {
  const key   = payload.type === 'url' ? payload.url! : payload.path!
  const src   = payload.type === 'url' ? payload.url! : (payload.url ?? payload.content ?? '')
  const title = key.replace(/\\/g, '/').split('/').pop() ?? key
  const idx   = previews.findIndex(p => p.key === key)
  const entry: LivePreviewEntry = { key, type: payload.type, src, title }
  previews = idx === -1 ? [...previews, entry] : previews.map(p => p.key === key ? entry : p)
  activeKey = key
  commit()
}

export function closeLivePreview(key: string): void {
  previews = previews.filter(p => p.key !== key)
  if (activeKey === key) activeKey = null
  commit()
}

export function selectLivePreview(key: string | null): void {
  activeKey = key
  commit()
}
