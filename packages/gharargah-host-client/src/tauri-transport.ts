import type { GharargahHostTransport } from "./transport.js"

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
type ListenFn = (
  event: string,
  handler: (event: { payload: unknown }) => void,
) => Promise<() => void>

export function createTauriTransport(
  invoke: InvokeFn,
  listen: ListenFn,
  clientId: string,
): GharargahHostTransport {
  return {
    async invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
      return (await invoke("gharargah_host_invoke", {
        channel,
        args,
        clientId,
      })) as T
    },
    on(channel: string, listener: (...args: unknown[]) => void) {
      let disposed = false
      let unlisten: (() => void) | null = null
      void listen(channel, event => {
        if (disposed) return
        const payload = event.payload
        const args = Array.isArray(payload) ? payload : [payload]
        listener(...args)
      }).then(fn => {
        if (disposed) fn()
        else unlisten = fn
      })
      return () => {
        disposed = true
        unlisten?.()
      }
    },
  }
}

export async function loadTauriTransport(): Promise<GharargahHostTransport | null> {
  if (typeof window === "undefined") return null
  try {
    const [{ invoke }, { listen }, { getCurrentWebviewWindow }] = await Promise.all([
      import("@tauri-apps/api/core"),
      import("@tauri-apps/api/event"),
      import("@tauri-apps/api/webviewWindow"),
    ])
    const clientId = getCurrentWebviewWindow().label
    return createTauriTransport(invoke, listen, clientId)
  } catch {
    return null
  }
}
