import type { GharargahHostAPI } from "@gharargah/workspace"
import type { AgentTransport } from "@gharargah/agents"

/**
 * WebSocket transport to Node agent-server.
 * Used when GHARARGAH_AGENT_RUNTIME=effect (default).
 */
export type EffectAgentsClient = AgentTransport & {
  close(): void
  ready: Promise<void>
}

export function createEffectAgentsClient(options?: {
  url?: string
}): EffectAgentsClient {
  /** Resolve on each connect so Playwright `__GHARARGAH_AGENT_WS_URL__` beats vite-baked 4751. */
  function resolveUrl(): string {
    if (options?.url) return options.url
    if (typeof window !== "undefined") {
      const injected = (window as Window & { __GHARARGAH_AGENT_WS_URL__?: string })
        .__GHARARGAH_AGENT_WS_URL__
      if (injected) return injected
    }
    try {
      const env = (import.meta as ImportMeta & { env?: { GHARARGAH_AGENT_WS_URL?: string } }).env
      if (env?.GHARARGAH_AGENT_WS_URL) return env.GHARARGAH_AGENT_WS_URL
    } catch {
      /* ignore */
    }
    const host =
      (typeof process !== "undefined" && process.env?.GHARARGAH_AGENT_HOST) || "127.0.0.1"
    const port =
      (typeof process !== "undefined" && process.env?.GHARARGAH_AGENT_PORT) || "4751"
    return `ws://${host}:${port}/agents`
  }

  let ws: WebSocket | null = null
  let nextId = 1
  let closed = false
  const pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >()
  const threadUpdated = new Set<(t: import("@gharargah/agents").AgentThread) => void>()
  const threadDelta = new Set<(d: import("@gharargah/agents").AgentThreadDelta) => void>()
  const permission = new Set<
    (input: {
      workspaceRootUri: string
      threadId: string
      permission: import("@gharargah/agents").AgentPermissionRequest
    }) => void
  >()
  const structured = new Set<(d: import("@gharargah/agents").AgentStructuredDelta) => void>()
  const shellReady = new Set<() => void>()

  let resolveReady!: () => void
  let ready = new Promise<void>(r => {
    resolveReady = r
  })

  function connect(): void {
    if (closed) return
    const url = resolveUrl()
    ws = new WebSocket(url)
    ws.addEventListener("open", () => resolveReady())
    ws.addEventListener("message", ev => {
      let msg: {
        id?: number
        result?: unknown
        error?: string
        event?: string
        payload?: unknown
      }
      try {
        msg = JSON.parse(String(ev.data)) as typeof msg
      } catch {
        return
      }
      if (msg.id !== undefined && pending.has(msg.id)) {
        const p = pending.get(msg.id)!
        pending.delete(msg.id)
        if (msg.error) p.reject(new Error(msg.error))
        else p.resolve(msg.result)
        return
      }
      switch (msg.event) {
        case "agents:threadUpdated":
          for (const cb of threadUpdated) cb(msg.payload as import("@gharargah/agents").AgentThread)
          break
        case "agents:threadDelta":
          for (const cb of threadDelta)
            cb(msg.payload as import("@gharargah/agents").AgentThreadDelta)
          break
        case "agents:structuredDelta":
          for (const cb of structured)
            cb(msg.payload as import("@gharargah/agents").AgentStructuredDelta)
          break
        case "agents:permissionRequest": {
          const payload = msg.payload as {
            workspaceRootUri: string
            threadId: string
            request: import("@gharargah/agents").AgentPermissionRequest
          }
          for (const cb of permission)
            cb({
              workspaceRootUri: payload.workspaceRootUri,
              threadId: payload.threadId,
              permission: payload.request,
            })
          break
        }
        case "agents:shellEnvReady":
          for (const cb of shellReady) cb()
          break
      }
    })
    ws.addEventListener("close", () => {
      if (closed) return
      // Reset ready so callers wait for the next open after reconnect.
      ready = new Promise<void>(r => {
        resolveReady = r
      })
      setTimeout(connect, 500)
    })
  }
  connect()

  function invoke(method: string, ...params: unknown[]): Promise<unknown> {
    return ready.then(
      () =>
        new Promise((resolve, reject) => {
          if (!ws || ws.readyState !== WebSocket.OPEN) {
            reject(new Error("agent-server websocket not open"))
            return
          }
          const id = nextId++
          pending.set(id, { resolve, reject })
          ws.send(JSON.stringify({ id, method, params }))
          setTimeout(() => {
            if (pending.has(id)) {
              pending.delete(id)
              reject(new Error(`agent-server timeout: ${method}`))
            }
          }, 120_000)
        }),
    )
  }

  return {
    get ready() {
      return ready
    },
    close() {
      closed = true
      ws?.close()
    },
    listThreads: (workspaceRootUri, workspaceRootPath) =>
      invoke("agents:listThreads", workspaceRootUri, workspaceRootPath) as Promise<
        import("@gharargah/agents").AgentWorkspaceSnapshot
      >,
    readThread: (workspaceRootUri, workspaceRootPath, threadId) =>
      invoke("agents:readThread", workspaceRootUri, workspaceRootPath, threadId) as Promise<
        import("@gharargah/agents").AgentThread | null
      >,
    createThread: input =>
      invoke("agents:createThread", input) as Promise<import("@gharargah/agents").AgentThread>,
    sendMessage: input =>
      invoke("agents:sendMessage", input) as Promise<import("@gharargah/agents").AgentThread>,
    createCheckpoint: input => invoke("agents:createCheckpoint", input) as Promise<{ id: string }>,
    revertCheckpoint: input =>
      invoke("agents:revertCheckpoint", input) as Promise<import("@gharargah/agents").AgentThread>,
    interruptTurn: input =>
      invoke("agents:interruptTurn", input) as Promise<
        import("@gharargah/agents").AgentThread | null
      >,
    resolvePermission: input => invoke("agents:resolvePermission", input).then(() => undefined),
    resolveUserInput: input => invoke("agents:resolveUserInput", input).then(() => undefined),
    setSessionConfigOption: input =>
      invoke("agents:setSessionConfigOption", input).then(() => undefined),
    setArchived: input =>
      invoke("agents:setArchived", input) as Promise<
        import("@gharargah/agents").AgentThread | null
      >,
    updateThreadSettings: input =>
      invoke("agents:updateThreadSettings", input) as Promise<
        import("@gharargah/agents").AgentThread | null
      >,
    listAgents: () =>
      invoke("agents:listAgents") as Promise<import("@gharargah/agents").AgentCatalogState>,
    refreshAgents: (providerId?: string) =>
      invoke("agents:refreshAgents", providerId) as Promise<
        import("@gharargah/agents").AgentCatalogState
      >,
    listProviders: () =>
      invoke("agents:listProviders") as Promise<import("@gharargah/agents").AgentProvidersState>,
    refreshProviders: (providerId?: string) =>
      invoke("agents:refreshProviders", providerId) as Promise<
        import("@gharargah/agents").AgentProvidersState
      >,
    getAcpTrace: providerId => invoke("agents:getAcpTrace", providerId),
    getConnectionState: provider =>
      invoke("agents:getConnectionState", provider) as Promise<
        import("@gharargah/agents").AgentConnectionState | null
      >,
    forceStopProvider: input => invoke("agents:forceStopProvider", input).then(() => undefined),
    listAcpSessions: input => invoke("agents:listAcpSessions", input),
    authenticate: input => invoke("agents:authenticate", input).then(() => undefined),
    closeAcpSession: input => invoke("agents:closeAcpSession", input).then(() => undefined),
    deleteAcpSession: input => invoke("agents:deleteAcpSession", input).then(() => undefined),
    logoutProvider: input => invoke("agents:logoutProvider", input).then(() => undefined),
    onThreadUpdated: cb => {
      threadUpdated.add(cb)
      return () => threadUpdated.delete(cb)
    },
    onThreadDelta: cb => {
      threadDelta.add(cb)
      return () => threadDelta.delete(cb)
    },
    onPermissionRequest: cb => {
      permission.add(cb)
      return () => permission.delete(cb)
    },
    onStructuredDelta: cb => {
      structured.add(cb)
      return () => structured.delete(cb)
    },
    onShellEnvReady: cb => {
      shellReady.add(cb)
      return () => shellReady.delete(cb)
    },
  }
}

/** Patch a GharargahHostAPI so agents.* talk to Effect runtime. */
export function bindEffectAgents(api: GharargahHostAPI, client: EffectAgentsClient): void {
  api.agents = client
}
