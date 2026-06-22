// Low-level IPC client for the C++ installer host.

declare global {
  interface Window {
    __binder_invoke?: (type: string, argsJson: string, reqId: string) => Promise<unknown>
    __binder_emit?: (event: string, ...args: unknown[]) => void
    __binder_events?: Record<string, Array<{cb: (...a: unknown[]) => void, max: number, count: number}>>
  }
}

type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string }

type Handler = (data: unknown) => void
const _handlers = new Map<string, Set<Handler>>()

// Set up the global event receiver. This runs at module load time and will
// overwrite whatever the C++ init script defined. We must handle BOTH:
//   1. ipc.ts `on/off` handlers (used when wails-shim loads successfully)
//   2. window.__binder_events handlers (used by window.runtime.EventsOn stubs)
// C++ emit_progress passes positional args: emit(event, pct, msg)
// NOT a single JSON string — so we spread the args to both handler registries.
if (typeof window !== 'undefined') {
  window.__binder_emit = (event: string, ...args: unknown[]) => {
    try {
      // 1. Fire ipc.ts on/off handlers with the first arg (or all args as array)
      const data = args.length === 1 ? args[0] : args
      _handlers.get(event)?.forEach(h => h(data))

      // 2. Fire window.runtime.EventsOn handlers (registered via __binder_events)
      //    Pass all args as positional so (pct, msg) callbacks work correctly.
      const entries = window.__binder_events?.[event]
      if (entries?.length) {
        const keep: typeof entries = []
        for (const entry of entries) {
          try { entry.cb(...args) } catch { /* ignore */ }
          entry.count++
          if (entry.max < 0 || entry.count < entry.max) keep.push(entry)
        }
        window.__binder_events![event] = keep
      }
    } catch { /* ignore */ }
  }
}

export function isWebViewHost(): boolean {
  return typeof window.__binder_invoke === 'function'
}

export async function invoke<T = unknown>(type: string, args: object = {}): Promise<T> {
  if (!window.__binder_invoke) throw new Error('IPC not available')
  // webview/webview automatically JSON.parses the resolve value,
  // so the result is already a parsed object: {ok, data} — not a string.
  const result = await window.__binder_invoke(type, JSON.stringify(args), crypto.randomUUID()) as IpcResult<T>
  if (!result.ok) throw new Error(result.error)
  return result.data
}

export function on(event: string, handler: Handler): () => void {
  if (!_handlers.has(event)) _handlers.set(event, new Set())
  _handlers.get(event)!.add(handler)
  return () => off(event, handler)
}

export function off(event: string, handler: Handler): void {
  _handlers.get(event)?.delete(handler)
}
