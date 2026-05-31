import type { Plugin, PluginCommand } from '@cmdide/plugin-sdk'
export type { Plugin }
export type { PluginCommand, PluginTabProps, PluginContext } from '@cmdide/plugin-sdk'

// Bundled source of the AI Chat Manager plugin (pre-built, embedded at compile time).
// This lets the plugin work immediately without requiring a manual install from the store.
import aiPluginCode from '../../../../packages/ai-plugin/dist/index.js?raw'

export interface InstalledPluginCommand {
  name: string
  description: string
  pluginId: string
  pluginName: string
  tabType?: string
  title: string
  handler?: () => void
}

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
// Two bundle formats are supported:
//
//   IIFE  — assigns to window.__cmdide_plugin__, loaded with new Function().
//           Newer plugins; avoids blob-URL CSP restrictions and shares the
//           host's React instance (window.React, set in main.tsx).
//
//   ES module — ends with `export { … }`, loaded via blob-URL import().
//               Legacy plugins (e.g. the bundled AI plugin).
//
// Format is auto-detected; the loop is sequential to avoid global-key races.
export async function loadInstalledPlugins(): Promise<Plugin[]> {
  const ids = getInstalledIds()
  const plugins: Plugin[] = []
  const GLOBAL_KEY = '__cmdide_plugin__'

  for (const id of ids) {
    try {
      const ext = getExternalPlugins().find(p => p.id === id)
      if (!ext?.code) continue

      const code = ext.code

      // If the bundle has no ES-module export syntax it's an IIFE bundle.
      const isIIFE = !(/\bexport\s*\{/.test(code) || /\bexport\s+default\b/.test(code))

      if (isIIFE) {
        // IIFE bundles assign the plugin object to window[GLOBAL_KEY] and
        // reference global React set up by main.tsx.
        ;(window as any)[GLOBAL_KEY] = undefined
        // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
        new Function(code)()
        const plugin = (window as any)[GLOBAL_KEY]
        ;(window as any)[GLOBAL_KEY] = undefined
        if (plugin?.id) plugins.push(plugin as Plugin)
      } else {
        // ES-module bundles are loaded via blob-URL dynamic import.
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

function defaultCommandDescription(plugin: Plugin): string {
  return `open ${plugin.name.toLowerCase()} tab`
}

function addInstalledCommand(
  registry: Record<string, InstalledPluginCommand>,
  plugin: Plugin,
  command: Pick<PluginCommand, 'name' | 'description' | 'handler'>
) {
  const name = command.name.trim().toLowerCase()
  if (!name || registry[name]) return

  registry[name] = {
    name,
    description: command.description?.trim() || defaultCommandDescription(plugin),
    pluginId: plugin.id,
    pluginName: plugin.name,
    tabType: plugin.tabType,
    title: plugin.tabTitle || plugin.tabType || plugin.name,
    handler: command.handler,
  }
}

export function buildInstalledPluginCommandMap(plugins: Plugin[]): Record<string, InstalledPluginCommand> {
  const registry: Record<string, InstalledPluginCommand> = {}

  for (const plugin of plugins) {
    for (const command of plugin.commands ?? []) {
      addInstalledCommand(registry, plugin, command)
    }

    // Match the SDK's documented default behavior: a tabType alone implies
    // a slash command that opens the plugin tab.
    if (plugin.tabType) {
      addInstalledCommand(registry, plugin, {
        name: plugin.tabType,
        description: defaultCommandDescription(plugin),
      })
    }
  }

  return registry
}

// ── Built-in plugin bootstrap ─────────────────────────────────────────────────
// Ensures the AI plugin is always available without requiring a manual install.
// Runs once at app startup; re-runs if the embedded code changes (version bump).
export function bootstrapBuiltins(): void {
  const AI_ID = 'ai'
  const existing = getExternalPlugins().find(p => p.id === AI_ID)
  // Re-seed if never installed or if the bundled code has changed
  if (!existing || existing.code !== aiPluginCode) {
    saveExternalPlugin({
      id: AI_ID,
      name: 'AI Chat Manager',
      description: 'Local Ollama chat manager with a two-panel workspace and persistent multi-chat sessions.',
      author: 'Command-IDE',
      version: '1.0.0',
      githubUrl: 'https://github.com/Command-IDE/ai-plugin',
      code: aiPluginCode,
    })
    installPlugin(AI_ID)
  }
}
