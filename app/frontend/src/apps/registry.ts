// Installed-app state. Source of truth is the on-disk config.json (via the
// generic config.get/config.set IPC); localStorage is only a synchronous
// read-through cache so the sidebar can render before the first IPC round-trip
// resolves.
import { invoke, isWebViewHost } from '../lib/ipc'

const KEY_INSTALLED = 'binder:apps:installed'
const EVENT = 'binder:apps-changed'

function readCache(): string[] {
  try { return JSON.parse(localStorage.getItem(KEY_INSTALLED) ?? '[]') }
  catch { return [] }
}

let cache: string[] = readCache()

function writeCache(ids: string[]): void {
  cache = ids
  try { localStorage.setItem(KEY_INSTALLED, JSON.stringify(ids)) } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(EVENT))
}

/** Reads installed_apps from config.json and hydrates the local cache. Call once at startup. */
export async function hydrateInstalledApps(): Promise<void> {
  if (!isWebViewHost()) return
  try {
    const data = await invoke<{ installed_apps?: string[] }>('config.get')
    writeCache(Array.isArray(data.installed_apps) ? data.installed_apps : [])
  } catch { /* keep whatever was cached */ }
}

export function getInstalledIds(): string[] { return cache }
export function isAppInstalled(id: string): boolean { return cache.includes(id) }

export async function installApp(id: string): Promise<void> {
  if (cache.includes(id)) return
  const next = [...cache, id]
  writeCache(next)
  if (isWebViewHost()) {
    await invoke('config.set', { key: 'installed_apps', value: next }).catch(() => {})
  }
}

export async function uninstallApp(id: string): Promise<void> {
  if (!cache.includes(id)) return
  const next = cache.filter(i => i !== id)
  writeCache(next)
  if (isWebViewHost()) {
    await invoke('config.set', { key: 'installed_apps', value: next }).catch(() => {})
  }
}

/** Subscribe to install/uninstall changes. Returns an unsubscribe function. */
export function onAppsChanged(handler: () => void): () => void {
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}
