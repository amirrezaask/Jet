import type { GharargahHostTransport } from "./transport.js"

type HostEvent = {
  protocolVersion: number
  sequence: number
  channel: string
  args: unknown[]
}

export function acceptHostEvent(lastSequence: number, message: HostEvent): boolean {
  return message.protocolVersion === 1 && Array.isArray(message.args) && message.sequence > lastSequence
}

export function websocketUrl(location: Pick<Location, "protocol" | "host">, since = 0): string {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:"
  return `${protocol}//${location.host}/ws?since=${since}`
}

export class WebHostTransport implements GharargahHostTransport {
  private readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  private socket: WebSocket | null = null
  private reconnectTimer: number | null = null
  private reconnectAttempt = 0
  private lastSequence = 0
  private closed = false
  private readonly clientId = crypto.randomUUID()

  constructor() {
    this.connect()
  }

  async invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
    const response = await fetch("/api/v1/rpc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channel, args, clientId: this.clientId }),
    })
    const payload = (await response.json()) as { value?: T; error?: { message?: string } }
    if (!response.ok) throw new Error(payload.error?.message ?? `Jet API request failed (${response.status})`)
    return payload.value as T
  }

  on(channel: string, listener: (...args: unknown[]) => void): () => void {
    let channelListeners = this.listeners.get(channel)
    if (!channelListeners) {
      channelListeners = new Set()
      this.listeners.set(channel, channelListeners)
    }
    channelListeners.add(listener)
    return () => {
      channelListeners!.delete(listener)
      if (channelListeners!.size === 0) this.listeners.delete(channel)
    }
  }

  close(): void {
    this.closed = true
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer)
    this.socket?.close()
  }

  private connect(): void {
    if (this.closed || typeof WebSocket === "undefined") return
    const socket = new WebSocket(websocketUrl(window.location, this.lastSequence))
    this.socket = socket
    socket.addEventListener("open", () => {
      this.reconnectAttempt = 0
      this.dispatch("connection:status", "connected")
    })
    socket.addEventListener("message", event => {
      if (typeof event.data !== "string") return
      let message: HostEvent
      try {
        message = JSON.parse(event.data) as HostEvent
      } catch {
        this.dispatch("protocol:error", "Invalid realtime message")
        return
      }
      if (message.protocolVersion !== 1 || !Array.isArray(message.args)) {
        this.dispatch("protocol:error", "Unsupported realtime protocol")
        return
      }
      if (!acceptHostEvent(this.lastSequence, message)) return
      this.lastSequence = message.sequence
      this.dispatch(message.channel, ...message.args)
    })
    socket.addEventListener("close", () => {
      if (this.socket !== socket || this.closed) return
      this.socket = null
      this.dispatch("connection:status", "disconnected")
      const delay = Math.min(10_000, 250 * 2 ** this.reconnectAttempt++)
      this.reconnectTimer = window.setTimeout(() => this.connect(), delay)
    })
    socket.addEventListener("error", () => socket.close())
  }

  private dispatch(channel: string, ...args: unknown[]): void {
    this.listeners.get(channel)?.forEach(listener => listener(...args))
  }
}

export function createWebTransport(): GharargahHostTransport {
  return new WebHostTransport()
}
