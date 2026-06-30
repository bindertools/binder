// App manifest loader — delegates to the remote bundle cache.
// Apps are downloaded on install and cached in localStorage; they are NOT
// bundled into the main Vite output. This keeps the host exe lean and makes
// every app a true opt-in download.
import type { AppManifest } from './types'
import { loadInstalledBundle } from './remoteRegistry'

/** No apps are bundled at build time; always returns an empty list. */
export function getAvailableAppIds(): string[] { return [] }

/** Loads a manifest for an installed app from its cached bundle. */
export function loadAppManifest(id: string): Promise<AppManifest | null> {
  return loadInstalledBundle(id)
}
