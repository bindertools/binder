// Low-level IPC client for the C++ WebView host.
// In Wails mode (window.__cmdide_invoke undefined), this module is inert.

declare global {
  interface Window {
    __cmdide_invoke?: (type: string, argsJson: string, reqId: string) => Promise<string>
    __cmdide_emit?: (event: string, dataJson: string) => void
  }
}

type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string }

type Handler = (data: unknown) => void
const _handlers = new Map<string, Set<Handler>>()

// Set up the global event receiver once at module load time.
if (typeof window !== 'undefined') {
  window.__cmdide_emit = (event: string, dataJson: string) => {
    try {
      const data = JSON.parse(dataJson)
      _handlers.get(event)?.forEach(h => h(data))
    } catch {
      // ignore malformed events
    }
  }
}

/** Returns true when running inside the C++ WebView host. */
export function isWebViewHost(): boolean {
  return typeof window.__cmdide_invoke === 'function'
}

/** Invoke an IPC method and return its result. */
export async function invoke<T = unknown>(type: string, args: object = {}): Promise<T> {
  if (!window.__cmdide_invoke) {
    throw new Error('IPC not available: not running in C++ WebView host')
  }
  const reqId = crypto.randomUUID()
  const raw = await window.__cmdide_invoke(type, JSON.stringify(args), reqId)
  const result = JSON.parse(raw) as IpcResult<T>
  if (!result.ok) throw new Error(result.error)
  return result.data
}

/** Register a handler for C++ → JS push events. Returns an unsubscribe function. */
export function on(event: string, handler: Handler): () => void {
  if (!_handlers.has(event)) _handlers.set(event, new Set())
  _handlers.get(event)!.add(handler)
  return () => off(event, handler)
}

/** Remove a previously registered event handler. */
export function off(event: string, handler: Handler): void {
  _handlers.get(event)?.delete(handler)
}
