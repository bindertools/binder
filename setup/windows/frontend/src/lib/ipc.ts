// Low-level IPC client for the C++ installer host.

declare global {
  interface Window {
    __binder_invoke?: (type: string, argsJson: string, reqId: string) => Promise<unknown>
    __binder_emit?:  (event: string, ...args: unknown[]) => void
  }
}

type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string }

type Handler = (data: unknown) => void
const _handlers = new Map<string, Set<Handler>>()

// Set up the global event receiver. C++ emit_progress passes positional args:
// emit(event, pct, msg) — NOT a single JSON string — so we spread the args.
if (typeof window !== 'undefined') {
  window.__binder_emit = (event: string, ...args: unknown[]) => {
    try {
      const data = args.length === 1 ? args[0] : args
      _handlers.get(event)?.forEach(h => h(data))
    } catch { /* ignore */ }
  }
}

export function isWebViewHost(): boolean {
  return typeof window.__binder_invoke === 'function'
}

export async function invoke<T = unknown>(type: string, args: object = {}): Promise<T> {
  if (!window.__binder_invoke) throw new Error('IPC not available')
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
