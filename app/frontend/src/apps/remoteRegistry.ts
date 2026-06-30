// Remote app registry client.
// Fetches the catalog from bindertools/app-registry on GitHub.
import type { AppManifest } from './types'

const REGISTRY_URL = 'https://raw.githubusercontent.com/bindertools/app-registry/main/registry.json'

export interface RemoteThemePreview {
  bg: string
  surface: string
  border: string
  text: string
  accent: string
}

export interface RemoteThemeEntry {
  id: string
  name: string
  description: string
  author: string
  official: boolean
  builtin?: boolean
  preview?: RemoteThemePreview
}

export interface RemoteAppEntry {
  id: string
  name: string
  description: string
  author: string
  version: string
  category: string
  repo: string
  official: boolean
  bundleUrl: string
}

export interface RemoteRegistry {
  version: number
  apps: RemoteAppEntry[]
  themes: RemoteThemeEntry[]
}

let catalogCache: RemoteRegistry | null = null
let fetchPromise: Promise<RemoteRegistry | null> | null = null

export function fetchRemoteCatalog(): Promise<RemoteRegistry | null> {
  if (catalogCache) return Promise.resolve(catalogCache)
  if (fetchPromise) return fetchPromise

  fetchPromise = fetch(REGISTRY_URL)
    .then(r => r.ok ? r.json() as Promise<RemoteRegistry> : null)
    .then(data => {
      if (data) catalogCache = data
      return data
    })
    .catch(() => null)
    .finally(() => { fetchPromise = null })

  return fetchPromise
}

export function clearRegistryCache(): void {
  catalogCache = null
  fetchPromise = null
}

// Inject and execute a remote IIFE bundle. The bundle must assign to window.__binder_app__.
// React must be exposed on window.React before calling this.
const _remoteCache = new Map<string, Promise<AppManifest | null>>()

export function loadRemoteBundle(id: string, bundleUrl: string): Promise<AppManifest | null> {
  const cached = _remoteCache.get(id)
  if (cached) return cached

  const localKey = `binder:remote-app:${id}:bundle`

  const promise = (async (): Promise<AppManifest | null> => {
    try {
      let code = localStorage.getItem(localKey)
      if (!code) {
        if (!bundleUrl) return null
        const res = await fetch(bundleUrl)
        if (!res.ok) return null
        code = await res.text()
        try {
          localStorage.setItem(localKey, code)
          localStorage.setItem(`binder:remote-app:${id}:url`, bundleUrl)
        } catch { /* quota */ }
      }
      return await _injectBundle(code)
    } catch {
      return null
    }
  })()

  _remoteCache.set(id, promise)
  return promise
}

export function invalidateRemoteBundle(id: string): void {
  _remoteCache.delete(id)
  localStorage.removeItem(`binder:remote-app:${id}:bundle`)
  localStorage.removeItem(`binder:remote-app:${id}:version`)
  localStorage.removeItem(`binder:remote-app:${id}:url`)
}

export function getInstalledBundleVersion(id: string): string | null {
  return localStorage.getItem(`binder:remote-app:${id}:version`)
}

export function setInstalledBundleVersion(id: string, version: string): void {
  localStorage.setItem(`binder:remote-app:${id}:version`, version)
}

/**
 * Loads an installed app's bundle using its cached URL.
 * Falls back to re-downloading if the bundle code was evicted from localStorage
 * but the URL was retained. Returns null if neither is available.
 */
export function loadInstalledBundle(id: string): Promise<AppManifest | null> {
  const bundleUrl = localStorage.getItem(`binder:remote-app:${id}:url`) ?? ''
  return loadRemoteBundle(id, bundleUrl)
}

function _injectBundle(code: string): Promise<AppManifest | null> {
  return new Promise(resolve => {
    (window as unknown as Record<string, unknown>)['__binder_app__'] = undefined
    const blob = new Blob([code], { type: 'application/javascript' })
    const url = URL.createObjectURL(blob)
    const script = document.createElement('script')
    script.src = url
    script.onload = () => {
      URL.revokeObjectURL(url)
      const manifest = (window as unknown as Record<string, unknown>)['__binder_app__'] as AppManifest | undefined
      resolve(manifest ?? null)
    }
    script.onerror = () => { URL.revokeObjectURL(url); resolve(null) }
    document.head.appendChild(script)
  })
}
