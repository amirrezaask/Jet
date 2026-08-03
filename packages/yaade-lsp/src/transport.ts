import { toSocket, WebSocketMessageReader, WebSocketMessageWriter } from "vscode-ws-jsonrpc"
import type { MessageReader, MessageWriter } from "vscode-jsonrpc/browser.js"

export function resolveLspWebSocketUrl(transportUrl: string): string {
  if (/^wss?:\/\//i.test(transportUrl)) return transportUrl
  if (typeof window === "undefined") {
    throw new Error("Relative LSP WebSocket URLs require a browser environment")
  }
  const path = transportUrl.startsWith("/") ? transportUrl : `/${transportUrl}`
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
  return `${protocol}//${window.location.host}${path}`
}

export type WebSocketTransports = {
  webSocket: WebSocket
  reader: MessageReader
  writer: MessageWriter
}

export async function createWebSocketTransports(transportUrl: string): Promise<WebSocketTransports> {
  const url = resolveLspWebSocketUrl(transportUrl)
  const webSocket = await new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(url)
    socket.onopen = () => resolve(socket)
    socket.onerror = () => reject(new Error(`WebSocket failed: ${url}`))
  })
  const socket = toSocket(webSocket)
  return {
    webSocket,
    reader: new WebSocketMessageReader(socket),
    writer: new WebSocketMessageWriter(socket),
  }
}
