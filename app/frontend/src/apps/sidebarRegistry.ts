import { useEffect, useState } from 'react'
import type React from 'react'
import type { AppCommand, AppManifest } from './types'
import { getInstalledIds, onAppsChanged } from './registry'
import { loadAppManifest } from './loader'

export interface SidebarPageEntry {
  id: string
  label: string
  icon: React.ComponentType
  order: number
  manifest: AppManifest
}

/** Loads manifests for every currently-installed app, re-running on install/uninstall. */
export function useInstalledApps(): AppManifest[] {
  const [apps, setApps] = useState<AppManifest[]>([])

  useEffect(() => {
    let cancelled = false

    const reload = async () => {
      const ids = getInstalledIds()
      const loaded = await Promise.all(ids.map(loadAppManifest))
      if (cancelled) return
      setApps(loaded.filter((m): m is AppManifest => m != null))
    }

    void reload()
    return onAppsChanged(() => { void reload() })
  }, [])

  return apps
}

/** Of the installed apps, the subset that claim a sidebar nav slot, sorted for display. */
export function useSidebarRegistry(): SidebarPageEntry[] {
  const apps = useInstalledApps()

  return apps
    .filter(a => a.sidebar)
    .map(a => ({
      id: a.id,
      label: a.sidebar!.label,
      icon: a.sidebar!.icon,
      order: a.sidebar!.order ?? 0,
      manifest: a,
    }))
    .sort((a, b) => a.order - b.order)
}

export interface InstalledAppCommand {
  name: string
  description: string
  appId: string
  appName: string
  tabType?: string
  title: string
  handler?: () => void
}

function defaultCommandDescription(app: AppManifest): string {
  return `open ${app.name.toLowerCase()} tab`
}

function addCommand(registry: Record<string, InstalledAppCommand>, app: AppManifest, command: Pick<AppCommand, 'name' | 'description' | 'handler'>) {
  const name = command.name.trim().toLowerCase()
  if (!name || registry[name]) return
  registry[name] = {
    name,
    description: command.description?.trim() || defaultCommandDescription(app),
    appId: app.id,
    appName: app.name,
    tabType: app.tabType,
    title: app.tabTitle || app.tabType || app.name,
    handler: command.handler,
  }
}

export function buildInstalledAppCommandMap(apps: AppManifest[]): Record<string, InstalledAppCommand> {
  const registry: Record<string, InstalledAppCommand> = {}
  for (const app of apps) {
    for (const command of app.commands ?? []) addCommand(registry, app, command)
    if (app.tabType) addCommand(registry, app, { name: app.tabType, description: defaultCommandDescription(app) })
  }
  return registry
}
