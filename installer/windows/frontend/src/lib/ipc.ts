// Low-level IPC client for the C++ installer host.
// Identical to app/frontend/src/lib/ipc.ts — kept as a separate copy.

declare global {
  interface Window {
    __cmdide_invoke?: (type: string, argsJson: string, reqId: string) => Promise<string>
    __cmdide_emit?: (event: string, dataJson: string) => void
  }
}

type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string }

type Handler = (data: unknown) => void
const _handlers = new Map<string, Set<Handler>>()

if (typeof window !== 'undefined') {
  window.__cmdide_emit = (event: string, dataJson: string) => {
    try {
      const data = JSON.parse(dataJson)
      _handlers.get(event)?.forEach(h => h(data))
    } catch {
      // ignore
    }
  }
}

export function isWebViewHost(): boolean {
  return typeof window.__cmdide_invoke === 'function'
}

export async function invoke<T = unknown>(type: string, args: object = {}): Promise<T> {
  if (!window.__cmdide_invoke) throw new Error('IPC not available')
  const raw = await window.__cmdide_invoke(type, JSON.stringify(args), crypto.randomUUID())
  const result = JSON.parse(raw) as IpcResult<T>
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
