// Low-level IPC client for the C++ WebView host.
// In Wails mode (window.__cmdide_invoke undefined), this module is inert.

declare global {
  interface Window {
    __cmdide_invoke?: (type: string, argsJson: string, reqId: string) => Promise<unknown>
    __cmdide_emit?: (event: string, data: unknown) => void
  }
}

type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string }

type Handler = (data: unknown) => void
const _handlers = new Map<string, Set<Handler>>()

// Set up the global event receiver once at module load time.
// C++ calls: window.__cmdide_emit(event, value)
// where `value` is already the correct JavaScript type (string, number, object)
// because the C++ emit uses json(data).dump() which produces a JS literal.
// No extra JSON.parse is needed — the JS engine already evaluated the literal.
if (typeof window !== 'undefined') {
  window.__cmdide_emit = (event: string, data: unknown) => {
    try {
      _handlers.get(event)?.forEach(h => h(data))
    } catch {
      // ignore handler errors
    }
  }
}

/** Returns true when running inside the C++ WebView host. */
export function isWebViewHost(): boolean {
  return typeof window.__cmdide_invoke === 'function'
}

/** Invoke an IPC method and return its result.
 *
 * webview/webview's onReply() already JSON.parses the C++ resolve() result,
 * so the Promise resolves with a plain JS object — not a raw JSON string.
 * We cast it directly; no second JSON.parse needed.
 */
export async function invoke<T = unknown>(type: string, args: object = {}): Promise<T> {
  if (!window.__cmdide_invoke) {
    throw new Error('IPC not available: not running in C++ WebView host')
  }
  const reqId = crypto.randomUUID()
  // webview resolves the promise with the already-parsed result object
  const result = await window.__cmdide_invoke(type, JSON.stringify(args), reqId) as IpcResult<T>
  if (!result.ok) throw new Error((result as { ok: false; error: string }).error)
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

/** Remove ALL handlers for an event (used by EventsOff which has no handler reference). */
export function offAll(event: string): void {
  _handlers.delete(event)
}
