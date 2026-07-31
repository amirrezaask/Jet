export type AgentsWsConnectionState = "connecting" | "open" | "reconnecting" | "closed"

export type BackoffConfig = {
  baseMs: number
  factor: number
  capMs: number
}

export const DEFAULT_AGENT_WS_BACKOFF: BackoffConfig = {
  baseMs: 300,
  factor: 2,
  capMs: 10_000,
}

/** Exponential backoff with full jitter: random in [0, min(cap, base * factor^attempt)]. */
export function computeReconnectDelayMs(
  attempt: number,
  config: BackoffConfig = DEFAULT_AGENT_WS_BACKOFF,
  random = Math.random,
): number {
  const exp = config.baseMs * config.factor ** Math.max(0, attempt)
  const ceiling = Math.min(config.capMs, exp)
  return Math.floor(random() * ceiling)
}
