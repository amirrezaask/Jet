import {
  tryDecodeWorkspaceSession,
  type WorkspaceSession,
} from "@yaade/rpc"
import { SessionRosterWriter } from "./session-roster-writer.js"

async function requestWorkspaceSession(
  path: string,
  init?: RequestInit,
): Promise<WorkspaceSession> {
  const response = await fetch(path, init)
  if (!response.ok) {
    throw new Error(`Jet workspace-session API failed (${response.status})`)
  }
  const raw: unknown = await response.json()
  const session = tryDecodeWorkspaceSession(raw)
  if (!session) {
    throw new Error("Jet workspace-session API returned an invalid payload")
  }
  return session
}

export async function loadWorkspaceSession(
  rootPath: string,
): Promise<WorkspaceSession> {
  const q = encodeURIComponent(rootPath)
  return requestWorkspaceSession(`/api/v1/workspace-session?root=${q}`)
}

export async function saveWorkspaceSession(
  session: WorkspaceSession,
): Promise<WorkspaceSession> {
  return requestWorkspaceSession("/api/v1/workspace-session", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(session),
    keepalive: true,
  })
}

export type WorkspaceSessionWriter = SessionRosterWriter & {
  enqueueWorkspace: (session: WorkspaceSession) => void
}

/**
 * Debounced single-writer for workspace sessions (same queue semantics as roster).
 */
export class WorkspaceSessionPersistWriter {
  private pending: WorkspaceSession | null = null
  private writing = false
  private retryAttempt = 0
  private cancelRetry: (() => void) | null = null
  private stopped = false

  constructor(
    private readonly save: (
      session: WorkspaceSession,
    ) => Promise<WorkspaceSession> = saveWorkspaceSession,
  ) {}

  enqueue(session: WorkspaceSession): void {
    if (this.stopped) return
    this.pending = session
    this.cancelScheduledRetry()
    void this.drain()
  }

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
    const timer = globalThis.setTimeout(() => {
      this.cancelRetry = null
      void this.drain()
    }, delayMs)
    this.cancelRetry = () => globalThis.clearTimeout(timer)
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
