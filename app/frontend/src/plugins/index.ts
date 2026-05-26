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

// ── Loaded plugin cache ───────────────────────────────────────────────────────
// Populated by App.tsx after loadInstalledPlugins() resolves so that Terminal
// can dynamically build its slash-command list from plugin.commands arrays.
let _loadedPlugins: Plugin[] = []

export function getLoadedPlugins(): Plugin[] { return _loadedPlugins }
export function setLoadedPlugins(plugins: Plugin[]): void { _loadedPlugins = plugins }

// ── Async plugin loader ───────────────────────────────────────────────────────
// Plugins may be built in two formats:
//
//   IIFE  — bundle assigns itself to window.__cmdide_plugin__ and reads React
//            from window.React (set in main.tsx). Executed via new Function()
//            so no blob-URL / CSP restrictions apply.
//
//   ESM   — legacy ES-module format loaded via a blob-URL dynamic import.
//            Kept for backward compatibility with older plugin builds.
//
// The loader auto-detects the format by checking for ES-module export syntax.
const PLUGIN_GLOBAL = '__cmdide_plugin__'

export async function loadInstalledPlugins(): Promise<Plugin[]> {
  const ids = getInstalledIds()
  const plugins: Plugin[] = []

  for (const id of ids) {
    try {
      const ext = getExternalPlugins().find(p => p.id === id)
      if (!ext?.code) continue

      const code = ext.code
      const isIIFE = !(/\bexport\s*\{/.test(code) || /\bexport\s+default\b/.test(code))

      if (isIIFE) {
        // IIFE bundle: evaluate it so window.__cmdide_plugin__ is assigned.
        ;(window as any)[PLUGIN_GLOBAL] = undefined
        // eslint-disable-next-line no-new-func
        new Function(code)()
        const plugin = (window as any)[PLUGIN_GLOBAL]
        ;(window as any)[PLUGIN_GLOBAL] = undefined
        if (plugin?.id) plugins.push(plugin as Plugin)
      } else {
        // ESM bundle: load via blob URL.
        const blob = new Blob([code], { type: 'text/javascript' })
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
