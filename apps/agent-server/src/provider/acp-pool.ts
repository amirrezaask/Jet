import {
  ACP_IDLE_REAP_MS,
  ACP_REAPER_INTERVAL_MS,
  AcpClient,
  closeAcpClient,
  runAcpRequest,
  type AcpTraceEntry,
} from "@gharargah/effect-acp"
import { Effect } from "effect"
import type { AgentConnectionState } from "@gharargah/agents"

type PooledClient = {
  client: AcpClient
  lastActive: number
  key: string
  connection?: AgentConnectionState
}

/**
 * Shared ACP client pool with idle reaping (t3-inspired timings).
 * Adapters register clients here so long-lived sessions are force-closed after idle.
 */
export class AcpClientPool {
  private clients = new Map<string, PooledClient>()
  private timer: ReturnType<typeof setInterval> | null = null
  private forceKillMs = 5_000
  /** Last known connection state keyed by provider/workspace filter. */
  private connectionByKey = new Map<string, AgentConnectionState>()

  startReaper(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      void this.reapIdle()
    }, ACP_REAPER_INTERVAL_MS)
    if (typeof this.timer === "object" && "unref" in this.timer) {
      this.timer.unref()
    }
  }

  stopReaper(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  get(key: string): AcpClient | undefined {
    return this.clients.get(key)?.client
  }

  set(key: string, client: AcpClient): void {
    this.clients.set(key, { client, lastActive: Date.now(), key })
    this.startReaper()
  }

  touch(key: string): void {
    const entry = this.clients.get(key)
    if (entry) entry.lastActive = Date.now()
  }

  setConnectionState(key: string, state: AgentConnectionState): void {
    this.connectionByKey.set(key, state)
    const entry = this.clients.get(key)
    if (entry) entry.connection = state
  }

  getConnectionState(filter?: {
    providerId?: string
    workspaceRootPath?: string
    connectionKey?: string
  }): AgentConnectionState {
    if (filter?.connectionKey) {
      const hit = this.connectionByKey.get(filter.connectionKey)
      if (hit) return hit
    }
    for (const [key, state] of this.connectionByKey) {
      if (filter?.providerId && !key.startsWith(`${filter.providerId}:`) && !key.includes(`:${filter.providerId}:`) && !key.startsWith(filter.providerId)) {
        // keys are driverId:instance:workspace — also match agent id prefixes
        if (!key.includes(filter.providerId)) continue
      }
      if (filter?.workspaceRootPath && !key.endsWith(`:${filter.workspaceRootPath}`)) continue
      return state
    }
    return {
      status: "disconnected",
      message: this.clients.size === 0 ? "no active ACP connections" : null,
      providerId: filter?.providerId ?? "effect",
      updatedAt: new Date().toISOString(),
    }
  }

  async delete(key: string): Promise<void> {
    const entry = this.clients.get(key)
    if (!entry) return
    this.clients.delete(key)
    await this.forceClose(entry.client)
  }

  async forceStop(filter?: {
    connectionKey?: string
    providerId?: string
    workspaceRootPath?: string
  }): Promise<string[]> {
    const stopped: string[] = []
    const keys = [...this.clients.keys()]
    for (const key of keys) {
      if (filter?.connectionKey && key !== filter.connectionKey) continue
      if (filter?.workspaceRootPath && !key.endsWith(`:${filter.workspaceRootPath}`)) continue
      if (filter?.providerId && !key.includes(filter.providerId)) continue
      const entry = this.clients.get(key)
      if (!entry) continue
      this.clients.delete(key)
      entry.client.forceKill()
      await this.forceClose(entry.client)
      stopped.push(key)
      this.connectionByKey.set(key, {
        status: "disconnected",
        message: "force-stopped",
        providerId: filter?.providerId ?? key.split(":")[0] ?? null,
        updatedAt: new Date().toISOString(),
      })
    }
    return stopped
  }

  getTrace(filter?: { providerId?: string; workspaceRootPath?: string }): AcpTraceEntry[] {
    const out: AcpTraceEntry[] = []
    for (const [key, entry] of this.clients) {
      if (filter?.workspaceRootPath && !key.endsWith(`:${filter.workspaceRootPath}`)) continue
      if (filter?.providerId && !key.includes(filter.providerId)) continue
      out.push(...entry.client.getTrace())
    }
    return out.slice(-500)
  }

  listSessions(filter?: {
    connectionKey?: string
    providerId?: string
    workspaceRootPath?: string
  }): Array<{ connectionKey: string; sessionId: string }> {
    const out: Array<{ connectionKey: string; sessionId: string }> = []
    for (const [key, entry] of this.clients) {
      if (filter?.connectionKey && key !== filter.connectionKey) continue
      if (filter?.workspaceRootPath && !key.endsWith(`:${filter.workspaceRootPath}`)) continue
      if (filter?.providerId && !key.includes(filter.providerId)) continue
      for (const sessionId of entry.client.sessionIds) {
        out.push({ connectionKey: key, sessionId })
      }
    }
    return out
  }

  async closeSession(input: {
    sessionId: string
    connectionKey?: string
    providerId?: string
    workspaceRootPath?: string
  }): Promise<boolean> {
    for (const [key, entry] of this.clients) {
      if (input.connectionKey && key !== input.connectionKey) continue
      if (input.workspaceRootPath && !key.endsWith(`:${input.workspaceRootPath}`)) continue
      if (input.providerId && !key.includes(input.providerId)) continue
      if (!entry.client.sessionIds.has(input.sessionId)) continue
      try {
        await runAcpRequest(entry.client, "session/close", { sessionId: input.sessionId })
      } catch {
        try {
          await runAcpRequest(entry.client, "session/delete", { sessionId: input.sessionId })
        } catch {
          /* best-effort */
        }
      }
      entry.client.sessionIds.delete(input.sessionId)
      return true
    }
    return false
  }

  async logout(filter?: {
    connectionKey?: string
    providerId?: string
    workspaceRootPath?: string
  }): Promise<boolean> {
    let any = false
    for (const [key, entry] of this.clients) {
      if (filter?.connectionKey && key !== filter.connectionKey) continue
      if (filter?.workspaceRootPath && !key.endsWith(`:${filter.workspaceRootPath}`)) continue
      if (filter?.providerId && !key.includes(filter.providerId)) continue
      try {
        await runAcpRequest(entry.client, "logout", {})
        any = true
      } catch {
        /* capability may be absent */
      }
    }
    return any
  }

  async reapIdle(now = Date.now()): Promise<string[]> {
    const reaped: string[] = []
    for (const [key, entry] of this.clients) {
      if (now - entry.lastActive >= ACP_IDLE_REAP_MS) {
        this.clients.delete(key)
        await this.forceClose(entry.client)
        reaped.push(key)
      }
    }
    return reaped
  }

  async closeAll(): Promise<void> {
    this.stopReaper()
    const keys = [...this.clients.keys()]
    for (const key of keys) {
      await this.delete(key)
    }
  }

  keys(): string[] {
    return [...this.clients.keys()]
  }

  listClients(filter?: { workspaceRootPath?: string }): AcpClient[] {
    const out: AcpClient[] = []
    for (const [key, entry] of this.clients) {
      if (filter?.workspaceRootPath && !key.endsWith(`:${filter.workspaceRootPath}`)) continue
      out.push(entry.client)
    }
    return out
  }

  size(): number {
    return this.clients.size
  }

  private async forceClose(client: AcpClient): Promise<void> {
    try {
      await Promise.race([
        Effect.runPromise(closeAcpClient(client)),
        new Promise<void>(resolve => setTimeout(resolve, this.forceKillMs)),
      ])
    } catch {
      /* ignore */
    }
  }
}

export const globalAcpPool = new AcpClientPool()
