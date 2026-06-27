import { type ComponentType, useEffect, useMemo, useState } from 'react'
import type { AppCommand, AppManifest } from './types'
import { getInstalledIds, onAppsChanged } from './registry'
import { loadAppManifest } from './loader'
import { reconcileSidebarOrder, useSidebarOrder } from './sidebarOrder'

export interface SidebarPageEntry {
  id: string
  label: string
  icon: ComponentType
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
    const unsubscribe = onAppsChanged(() => { void reload() })
    return () => { cancelled = true; unsubscribe() }
  }, [])

  return apps
}

/** Of the installed apps, the subset that claim a sidebar nav slot. */
function useSidebarCapableApps(): SidebarPageEntry[] {
  const apps = useInstalledApps()

  return useMemo(() => apps
    .filter(a => a.sidebar)
    .map(a => ({
      id: a.id,
      label: a.sidebar!.label,
      icon: a.sidebar!.icon,
      order: a.sidebar!.order ?? 0,
      manifest: a,
    }))
    .sort((a, b) => a.order - b.order), [apps])
}

/**
 * Sidebar-capable apps in the user's custom order (reconciled against
 * install/uninstall), split into the row shown directly in the sidebar and
 * the overflow ("more menu") list. See apps/sidebarOrder.ts.
 */
export function useOrderedSidebarApps(): { visible: SidebarPageEntry[]; overflow: SidebarPageEntry[] } {
  const entries = useSidebarCapableApps()
  const order = useSidebarOrder()

  useEffect(() => {
    reconcileSidebarOrder(entries.map(e => e.id), entries.map(e => e.id))
  }, [entries])

  const byId = useMemo(() => new Map(entries.map(e => [e.id, e])), [entries])

  return useMemo(() => ({
    visible:  order.visible.map(id => byId.get(id)).filter((e): e is SidebarPageEntry => e != null),
    overflow: order.overflow.map(id => byId.get(id)).filter((e): e is SidebarPageEntry => e != null),
  }), [order, byId])
}

/** Of the installed apps, the subset that claim a sidebar nav slot, in their
 * manifest-declared default order (not the user's custom sidebar order). */
export function useSidebarRegistry(): SidebarPageEntry[] {
  return useSidebarCapableApps()
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
