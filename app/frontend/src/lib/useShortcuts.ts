import { useEffect, useRef } from 'react'

const STORAGE_KEY = 'cmdide_keybindings'

export interface ShortcutDef {
  id:          string
  label:       string
  defaultKey:  string
  description: string
  group:       string
}

export const SHORTCUT_DEFS: ShortcutDef[] = [
  { id: 'next-tab',      label: 'Next Tab',        defaultKey: 'Ctrl+Tab',       description: 'Switch to the next tab in the focused pane',     group: 'Tabs'       },
  { id: 'prev-tab',      label: 'Previous Tab',    defaultKey: 'Ctrl+Shift+Tab', description: 'Switch to the previous tab in the focused pane',  group: 'Tabs'       },
  { id: 'close-tab',     label: 'Close Tab',       defaultKey: 'Ctrl+W',         description: 'Close the active tab',                            group: 'Tabs'       },
  { id: 'new-terminal',  label: 'New Terminal',    defaultKey: 'Ctrl+T',         description: 'Open a new terminal tab in the focused pane',     group: 'Tabs'       },
  { id: 'tab-1',         label: 'Go to Tab 1',     defaultKey: 'Ctrl+1',         description: 'Switch to the 1st tab in the focused pane',       group: 'Tabs'       },
  { id: 'tab-2',         label: 'Go to Tab 2',     defaultKey: 'Ctrl+2',         description: 'Switch to the 2nd tab',                           group: 'Tabs'       },
  { id: 'tab-3',         label: 'Go to Tab 3',     defaultKey: 'Ctrl+3',         description: 'Switch to the 3rd tab',                           group: 'Tabs'       },
  { id: 'tab-4',         label: 'Go to Tab 4',     defaultKey: 'Ctrl+4',         description: 'Switch to the 4th tab',                           group: 'Tabs'       },
  { id: 'tab-5',         label: 'Go to Tab 5',     defaultKey: 'Ctrl+5',         description: 'Switch to the 5th tab',                           group: 'Tabs'       },
  { id: 'tab-6',         label: 'Go to Tab 6',     defaultKey: 'Ctrl+6',         description: 'Switch to the 6th tab',                           group: 'Tabs'       },
  { id: 'tab-7',         label: 'Go to Tab 7',     defaultKey: 'Ctrl+7',         description: 'Switch to the 7th tab',                           group: 'Tabs'       },
  { id: 'tab-8',         label: 'Go to Tab 8',     defaultKey: 'Ctrl+8',         description: 'Switch to the 8th tab',                           group: 'Tabs'       },
  { id: 'tab-9',         label: 'Go to Tab 9',     defaultKey: 'Ctrl+9',         description: 'Switch to the 9th tab',                           group: 'Tabs'       },
  { id: 'open-search',   label: 'Command Palette', defaultKey: 'Ctrl+K',         description: 'Open the command palette and quick file search',  group: 'Navigation' },
  { id: 'go-terminal',   label: 'Go to Terminal',  defaultKey: 'Ctrl+`',         description: 'Switch the focused pane to the Terminal view',    group: 'Navigation' },
  { id: 'go-editor',     label: 'Go to Editor',    defaultKey: 'Ctrl+Shift+E',   description: 'Switch the focused pane to the Code Editor view', group: 'Navigation' },
  { id: 'open-settings', label: 'Open Settings',   defaultKey: 'Ctrl+,',         description: 'Open the Settings page',                          group: 'Navigation' },
]

export type ShortcutHandlers = Partial<Record<string, () => void>>

// Pause flag — set to true while a key-capture dialog is open so the
// shortcut manager does not claim the captured keystroke.
let _paused = false
export function setShortcutsPaused(paused: boolean) { _paused = paused }

export function loadKeybindings(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Record<string, string>) : {}
  } catch { return {} }
}

export function saveKeybindings(bindings: Record<string, string>): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings)) } catch { /* ignore */ }
}

export function eventToKey(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey)  parts.push('Ctrl')
  if (e.shiftKey) parts.push('Shift')
  if (e.altKey)   parts.push('Alt')
  if (e.metaKey)  parts.push('Meta')
  const key = e.key === ' ' ? 'Space' : e.key
  parts.push(key)
  return parts.join('+')
}

export function useShortcuts(
  handlers: ShortcutHandlers,
  customBindings: Record<string, string>,
): void {
  const handlersRef = useRef(handlers)
  const bindingsRef = useRef(customBindings)

  useEffect(() => { handlersRef.current = handlers })
  useEffect(() => { bindingsRef.current = customBindings })

  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (_paused) return

      // Don't intercept while typing in a text input or textarea
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea') return

      const pressed = eventToKey(e)
      for (const def of SHORTCUT_DEFS) {
        const bound = bindingsRef.current[def.id] ?? def.defaultKey
        if (pressed === bound && handlersRef.current[def.id]) {
          e.preventDefault()
          e.stopPropagation()
          handlersRef.current[def.id]!()
          return
        }
      }
    }
    window.addEventListener('keydown', handle, true)
    return () => window.removeEventListener('keydown', handle, true)
  }, [])
}
