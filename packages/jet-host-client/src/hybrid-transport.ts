import type { JetHostTransport } from "./transport.js"

export type HybridTransportOptions = {
  primary: JetHostTransport
  fallback?: JetHostTransport
  /** When true, log channels routed to fallback (dev only). */
  logFallback?: boolean
}

export function createHybridTransport(options: HybridTransportOptions): JetHostTransport {
  const { primary, fallback, logFallback = false } = options

  return {
    async invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
      try {
        return await primary.invoke<T>(channel, ...args)
      } catch (primaryErr) {
        if (!fallback) throw primaryErr
        if (logFallback) {
          console.warn(`[jet-host] falling back to sidecar for ${channel}`, primaryErr)
        }
        return fallback.invoke<T>(channel, ...args)
      }
    },
    on(channel: string, listener: (...args: unknown[]) => void) {
      const unsubs = [
        primary.on(channel, listener),
        fallback?.on(channel, listener) ?? (() => {}),
      ]
      return () => {
        for (const unsub of unsubs) unsub()
      }
    },
  }
}
