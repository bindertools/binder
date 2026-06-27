import { invoke, on } from './ipc'

export type Release = {
  version:      string
  name:         string
  publishedAt:  string
  prerelease:   boolean
  downloadURL:  string
  releaseNotes: string
}

export const Ready          = ()                                       => invoke('installer.ready')
export const GetInstallDir  = ()                                       => invoke<string>('installer.getInstallDir')
export const GetChannel     = ()                                       => invoke<string>('installer.getChannel')
export const GetReleases    = ()                                       => invoke<Release[]>('installer.getReleases')
export const Install        = (v: string, d: boolean, apps: string[]) => invoke('installer.install', { version: v, createDesktop: d, seedApps: apps })
export const LaunchAndClose = ()                                       => invoke('installer.launch')
export const CloseInstaller = ()                                       => invoke('installer.close')

// C++ emits multi-arg events (e.g. pct, msg as two args). Wrap them so callers
// receive spread positional args rather than a single array.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function EventsOn(event: string, handler: (...args: any[]) => void): () => void {
  return on(event, (data) => {
    if (Array.isArray(data)) {
      handler(...data)
    } else {
      handler(data)
    }
  })
}
