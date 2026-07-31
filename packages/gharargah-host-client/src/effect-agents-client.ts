import type { GharargahHostAPI } from "@gharargah/workspace"
import type { AgentTransport } from "@gharargah/agents"
import {
  AgentRpcRequest,
  AGENT_PUSH_EVENTS,
  decodeAgentPushPayload,
  decodeAgentRpcResponse,
  normalizeAgentRpcError,
  type AgentPushEventName,
} from "@gharargah/rpc"
import { Effect, Schema } from "effect"
import { agentRpcClientErrorFromWire, AgentRpcClientError } from "./agent-rpc-client-error.js"
import {
  computeReconnectDelayMs,
  DEFAULT_AGENT_WS_BACKOFF,
  type AgentsWsConnectionState,
} from "./agent-ws-reconnect.js"

const RPC_TIMEOUT_MS = 120_000

/**
 * WebSocket transport to Node agent-server.
 * Used when GHARARGAH_AGENT_RUNTIME=effect (default).
 */
export type EffectAgentsClient = AgentTransport & {
  close(): void
  ready: Promise<void>
  getWsConnectionState(): AgentsWsConnectionState
  onWsConnectionState(cb: (state: AgentsWsConnectionState) => void): () => void
}

export function createEffectAgentsClient(options?: {
  url?: string
  rpcTimeoutMs?: number
}): EffectAgentsClient {
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
    return `ws://127.0.0.1:4751/agents`
  }

  let ws: WebSocket | null = null
  let nextId = 1
  let disposed = false
  let reconnectAttempt = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let connectionState: AgentsWsConnectionState = "connecting"
  const connectionStateListeners = new Set<(state: AgentsWsConnectionState) => void>()

  const pending = new Map<
    number,
    {
      resolve: (v: unknown) => void
      reject: (e: AgentRpcClientError) => void
      timer: ReturnType<typeof setTimeout>
    }
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

  function setConnectionState(next: AgentsWsConnectionState): void {
    if (connectionState === next) return
    connectionState = next
    for (const cb of connectionStateListeners) {
      try {
        cb(next)
      } catch {
        /* listener errors must not break the socket */
      }
    }
  }

  function rejectAllPending(reason: AgentRpcClientError): void {
    for (const [id, p] of pending) {
      clearTimeout(p.timer)
      p.reject(reason)
      pending.delete(id)
    }
  }

  function clearReconnectTimer(): void {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  function scheduleReconnect(): void {
    if (disposed || reconnectTimer) return
    setConnectionState("reconnecting")
    const delay = computeReconnectDelayMs(reconnectAttempt, DEFAULT_AGENT_WS_BACKOFF)
    reconnectAttempt += 1
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, delay)
  }

  function dispatchPush(event: string, payload: unknown): void {
    if (!(AGENT_PUSH_EVENTS as readonly string[]).includes(event)) return
    const pushEvent = event as AgentPushEventName
    const decoded = Effect.runSync(
      decodeAgentPushPayload(pushEvent, payload).pipe(
        Effect.catchAll(() => Effect.succeed(null)),
      ),
    )
    if (decoded === null) {
      console.warn(`[gharargah-agents] dropped malformed push frame: ${event}`)
      return
    }

    const safeForEach = <T>(listeners: Set<(arg: T) => void>, arg: T) => {
      for (const cb of listeners) {
        try {
          cb(arg)
        } catch {
          /* one listener must not block others */
        }
      }
    }

    switch (pushEvent) {
      case "agents:threadUpdated":
        safeForEach(threadUpdated, payload as import("@gharargah/agents").AgentThread)
        break
      case "agents:threadDelta":
        safeForEach(threadDelta, payload as import("@gharargah/agents").AgentThreadDelta)
        break
      case "agents:structuredDelta":
        safeForEach(structured, payload as import("@gharargah/agents").AgentStructuredDelta)
        break
      case "agents:permissionRequest": {
        const p = payload as {
          workspaceRootUri: string
          threadId: string
          request: import("@gharargah/agents").AgentPermissionRequest
        }
        safeForEach(permission, {
          workspaceRootUri: p.workspaceRootUri,
          threadId: p.threadId,
          permission: p.request,
        })
        break
      }
      case "agents:shellEnvReady":
        for (const cb of shellReady) {
          try {
            cb()
          } catch {
            /* ignore */
          }
        }
        break
    }
  }

  function handleMessage(raw: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return
    }
    const decoded = Effect.runSync(
      decodeAgentRpcResponse(parsed).pipe(Effect.catchAll(() => Effect.succeed(null))),
    )
    if (!decoded) return

    if ("result" in decoded && decoded.id !== undefined) {
      const id = Number(decoded.id)
      const p = pending.get(id)
      if (p) {
        clearTimeout(p.timer)
        pending.delete(id)
        p.resolve(decoded.result)
      }
      return
    }

    if ("error" in decoded && decoded.id !== undefined) {
      const id = Number(decoded.id)
      const p = pending.get(id)
      if (p) {
        clearTimeout(p.timer)
        pending.delete(id)
        p.reject(agentRpcClientErrorFromWire(decoded.error))
      }
      return
    }

    const push = parsed as { event?: string; payload?: unknown }
    if (push.event) {
      dispatchPush(push.event, push.payload ?? null)
    }
  }

  function connect(): void {
    if (disposed) return
    clearReconnectTimer()
    setConnectionState(reconnectAttempt > 0 ? "reconnecting" : "connecting")
    const url = resolveUrl()
    ws = new WebSocket(url)
    ws.addEventListener("open", () => {
      reconnectAttempt = 0
      setConnectionState("open")
      resolveReady()
    })
    ws.addEventListener("message", ev => handleMessage(String(ev.data)))
    ws.addEventListener("close", () => {
      ws = null
      if (disposed) {
        setConnectionState("closed")
        return
      }
      rejectAllPending(
        new AgentRpcClientError({
          _tag: "HostDisconnected",
          message: "agent-server websocket disconnected",
          retryable: true,
        }),
      )
      ready = new Promise<void>(r => {
        resolveReady = r
      })
      scheduleReconnect()
    })
    ws.addEventListener("error", () => {
      /* close handler performs reconnect + pending rejection */
    })
  }

  connect()

  function invoke(method: string, ...params: unknown[]): Promise<unknown> {
    return ready.then(
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            if (!ws || ws.readyState !== WebSocket.OPEN) {
              return yield* Effect.fail(
                new AgentRpcClientError({
                  _tag: "HostDisconnected",
                  message: "agent-server websocket not open",
                  retryable: true,
                }),
              )
            }
            const id = nextId++
            const encoded = yield* Effect.mapError(
              Schema.encode(AgentRpcRequest)({
                id,
                method,
                params: params.length <= 1 ? params[0] : params,
              }),
              cause =>
                new AgentRpcClientError({
                  _tag: "InvalidRpcPayload",
                  message: `invalid agent RPC encode: ${String(cause)}`,
                  retryable: false,
                }),
            )
            return yield* Effect.async<unknown, AgentRpcClientError>(resume => {
              const timer = setTimeout(() => {
                if (pending.has(id)) {
                  pending.delete(id)
                  resume(
                    Effect.fail(
                      new AgentRpcClientError({
                        _tag: "RpcTimeout",
                        message: `agent-server timeout: ${method}`,
                        retryable: true,
                        detail: { method, timeoutMs: options?.rpcTimeoutMs ?? RPC_TIMEOUT_MS },
                      }),
                    ),
                  )
                }
              }, options?.rpcTimeoutMs ?? RPC_TIMEOUT_MS)
              pending.set(id, {
                resolve: v => resume(Effect.succeed(v)),
                reject: e => resume(Effect.fail(e)),
                timer,
              })
              ws!.send(JSON.stringify(encoded))
            })
          }),
        ),
    )
  }

  return {
    get ready() {
      return ready
    },
    getWsConnectionState() {
      return connectionState
    },
    onWsConnectionState(cb) {
      connectionStateListeners.add(cb)
      cb(connectionState)
      return () => connectionStateListeners.delete(cb)
    },
    close() {
      disposed = true
      clearReconnectTimer()
      rejectAllPending(
        new AgentRpcClientError({
          _tag: "HostDisconnected",
          message: "agent-server websocket closed",
          retryable: false,
        }),
      )
      setConnectionState("closed")
      ws?.close()
      ws = null
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
