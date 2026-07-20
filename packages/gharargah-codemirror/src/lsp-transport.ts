import type { Transport } from "@codemirror/lsp-client"

export function simpleWebSocketTransport(uri: string): Promise<Transport> {
  const handlers: Array<(value: string) => void> = []
  const sock = new WebSocket(uri)
  sock.onmessage = e => {
    const data = typeof e.data === "string" ? e.data : e.data.toString()
    for (const h of handlers) h(data)
  }
  return new Promise((resolve, reject) => {
    sock.onopen = () =>
      resolve({
        send(message: string) {
          sock.send(message)
        },
        subscribe(handler: (value: string) => void) {
          handlers.push(handler)
        },
        unsubscribe(handler: (value: string) => void) {
          const idx = handlers.indexOf(handler)
          if (idx >= 0) handlers.splice(idx, 1)
        },
      })
    sock.onerror = () => reject(new Error(`WebSocket failed: ${uri}`))
  })
}
