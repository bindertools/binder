// Discovers first-party app packages and lazily loads them.
//
// Vite's import.meta.glob turns this into a static map of id -> () => import(...),
// one chunk per package. A package's code is never fetched or parsed unless its
// loader function is actually called (i.e. the app is installed and mounted).
import type { AppManifest } from './types'

const modules = import.meta.glob<{ default: AppManifest }>('../../../../packages/*/index.tsx')

function idFromPath(path: string): string {
  const match = path.match(/packages\/([^/]+)\/index\.tsx$/)
  return match ? match[1] : path
}

const loadersById = new Map<string, () => Promise<{ default: AppManifest }>>()
for (const [path, loader] of Object.entries(modules)) {
  loadersById.set(idFromPath(path), loader)
}

/** All known first-party app package ids (regardless of install state). */
export function getAvailableAppIds(): string[] {
  return [...loadersById.keys()]
}

const manifestCache = new Map<string, Promise<AppManifest | null>>()

/** Loads (and caches) an app's manifest. Resolves to null if no such app package exists. */
export function loadAppManifest(id: string): Promise<AppManifest | null> {
  let promise = manifestCache.get(id)
  if (promise) return promise

  const loader = loadersById.get(id)
  promise = loader
    ? loader().then(m => m.default).catch(err => {
        console.warn(`[apps] Failed to load "${id}":`, err)
        return null
      })
    : Promise.resolve(null)

  manifestCache.set(id, promise)
  return promise
}
