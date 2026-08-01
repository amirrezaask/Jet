import type { PersistedSessionRoster } from "./session-roster-store.js"

type SaveRoster = (
  roster: PersistedSessionRoster,
) => Promise<PersistedSessionRoster>

type ScheduleRetry = (retry: () => void, delayMs: number) => () => void

const defaultScheduleRetry: ScheduleRetry = (retry, delayMs) => {
  const timer = globalThis.setTimeout(retry, delayMs)
  return () => globalThis.clearTimeout(timer)
}

/**
 * Single-writer queue for the authoritative server roster.
 *
 * Snapshots are replace operations, so only the newest pending snapshot matters.
 * Failed writes remain pending and retry; they are never silently discarded.
 */
export class SessionRosterWriter {
  private pending: PersistedSessionRoster | null = null
  private writing = false
  private retryAttempt = 0
  private cancelRetry: (() => void) | null = null
  private stopped = false

  constructor(
    private readonly save: SaveRoster,
    private readonly scheduleRetry: ScheduleRetry = defaultScheduleRetry,
  ) {}

  enqueue(roster: PersistedSessionRoster): void {
    if (this.stopped) return
    this.pending = roster
    this.cancelScheduledRetry()
    void this.drain()
  }

  /** Retry immediately, used for online/page-hide signals. */
  flush(): void {
    if (this.stopped) return
    this.cancelScheduledRetry()
    void this.drain()
  }

  stop(): void {
    this.stopped = true
    this.cancelScheduledRetry()
  }

  private cancelScheduledRetry(): void {
    this.cancelRetry?.()
    this.cancelRetry = null
  }

  private scheduleNextRetry(): void {
    if (this.stopped || this.cancelRetry || !this.pending) return
    const delayMs = Math.min(5_000, 250 * 2 ** this.retryAttempt)
    this.retryAttempt += 1
    this.cancelRetry = this.scheduleRetry(() => {
      this.cancelRetry = null
      void this.drain()
    }, delayMs)
  }

  private async drain(): Promise<void> {
    if (this.stopped || this.writing || !this.pending) return
    this.writing = true
    try {
      while (!this.stopped && this.pending) {
        const snapshot = this.pending
        this.pending = null
        try {
          await this.save(snapshot)
          this.retryAttempt = 0
        } catch {
          // A newer snapshot wins. Otherwise retain the failed one for retry.
          this.pending ??= snapshot
          this.scheduleNextRetry()
          return
        }
      }
    } finally {
      this.writing = false
      if (this.pending && !this.cancelRetry) void this.drain()
    }
  }
}
