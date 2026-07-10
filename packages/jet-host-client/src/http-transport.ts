import type { JetHostTransport } from "./transport.js"

export function createHttpTransport(baseUrl: string): JetHostTransport {
  const wsUrl = baseUrl.replace(/^http/, "ws") + "/events"
  let ws: WebSocket | null = null
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  function dispatch(channel: string, args: unknown[]) {
    const set = listeners.get(channel)
    if (!set) return
    for (const cb of set) cb(...args)
  }

  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
    ws = new WebSocket(wsUrl)
    ws.onmessage = event => {
      try {
        const msg = JSON.parse(String(event.data)) as { channel: string; args: unknown[] }
        dispatch(msg.channel, msg.args)
      } catch {
        /* ignore malformed */
      }
    }
    ws.onclose = () => {
      if (reconnectTimer) clearTimeout(reconnectTimer)
      reconnectTimer = setTimeout(connect, 500)
    }
  }

  connect()

  return {
    async invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
      const res = await fetch(`${baseUrl}/rpc`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel, args }),
      })
      const body = (await res.json()) as { ok: boolean; result?: T; error?: string }
      if (!body.ok) throw new Error(body.error ?? `host rpc failed: ${channel}`)
      return body.result as T
    },
    on(channel: string, listener: (...args: unknown[]) => void) {
      let set = listeners.get(channel)
      if (!set) {
        set = new Set()
        listeners.set(channel, set)
      }
      set.add(listener)
      connect()
      return () => {
        set!.delete(listener)
        if (set!.size === 0) listeners.delete(channel)
      }
    },
  }
}
