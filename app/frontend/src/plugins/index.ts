import type { Plugin } from '@cmdide/plugin-sdk'
export type { Plugin }
export type { PluginCommand, PluginTabProps, PluginContext } from '@cmdide/plugin-sdk'

// ── Storage keys ─────────────────────────────────────────────────────────────
const KEY_INSTALLED = 'cmdide:plugins:installed'
const KEY_EXTERNAL  = 'cmdide:plugins:external'

// ── Install state ─────────────────────────────────────────────────────────────
export function getInstalledIds(): string[] {
  try { return JSON.parse(localStorage.getItem(KEY_INSTALLED) ?? '[]') }
  catch { return [] }
}

export function installPlugin(id: string): void {
  const ids = getInstalledIds()
  if (!ids.includes(id)) localStorage.setItem(KEY_INSTALLED, JSON.stringify([...ids, id]))
}

export function uninstallPlugin(id: string): void {
  localStorage.setItem(KEY_INSTALLED, JSON.stringify(getInstalledIds().filter(i => i !== id)))
  removeExternalPlugin(id)
}

export function isInstalled(id: string): boolean {
  return getInstalledIds().includes(id)
}

// ── External plugin records ───────────────────────────────────────────────────
export interface ExternalPluginRecord {
  id: string
  name: string
  description: string
  author: string
  version: string
  githubUrl: string
  code: string
}

export function getExternalPlugins(): ExternalPluginRecord[] {
  try { return JSON.parse(localStorage.getItem(KEY_EXTERNAL) ?? '[]') }
  catch { return [] }
}

export function saveExternalPlugin(record: ExternalPluginRecord): void {
  const rest = getExternalPlugins().filter(p => p.id !== record.id)
  localStorage.setItem(KEY_EXTERNAL, JSON.stringify([...rest, record]))
}

export function removeExternalPlugin(id: string): void {
  localStorage.setItem(KEY_EXTERNAL, JSON.stringify(getExternalPlugins().filter(p => p.id !== id)))
}

// ── Async plugin loader ───────────────────────────────────────────────────────
export async function loadInstalledPlugins(): Promise<Plugin[]> {
  const ids = getInstalledIds()
  const plugins: Plugin[] = []

  for (const id of ids) {
    try {
      const ext = getExternalPlugins().find(p => p.id === id)
      if (ext?.code) {
        const blob = new Blob([ext.code], { type: 'text/javascript' })
        const url  = URL.createObjectURL(blob)
        const mod  = await import(/* @vite-ignore */ url)
        URL.revokeObjectURL(url)
        if (mod.default?.id) plugins.push(mod.default as Plugin)
      }
    } catch (err) {
      console.warn(`[plugins] Failed to load "${id}":`, err)
    }
  }

  return plugins
}
