import http from "node:http"
import { Effect } from "effect"
import { WebSocketServer, type WebSocket } from "ws"
import type { AgentThread } from "@gharargah/agents"
import { makeOrchestrationLive, OrchestrationService, runOrch } from "../effect/services.js"
import type { OrchEventSink } from "../orchestration/engine.js"
import { globalAcpPool } from "../provider/acp-pool.js"
import { closeMcpBridge } from "../provider/mcp-bridge.js"
import { getShellEnvStatus } from "../shell-env.js"

export type AgentServerOptions = {
  host?: string
  port?: number
}

type RpcRequest = {
  id?: string | number
  method: string
  params?: unknown
}

type Client = {
  ws: WebSocket
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {}
}

export async function startAgentServer(opts: AgentServerOptions = {}): Promise<{
  host: string
  port: number
  close: () => Promise<void>
}> {
  const host = opts.host ?? process.env.GHARARGAH_AGENT_HOST ?? "127.0.0.1"
  const requestedPort = opts.port ?? Number(process.env.GHARARGAH_AGENT_PORT ?? 4751)

  const clients = new Set<Client>()
  const broadcast = (event: string, payload: unknown) => {
    const msg = JSON.stringify({ event, payload })
    for (const c of clients) {
      if (c.ws.readyState === c.ws.OPEN) c.ws.send(msg)
    }
  }

  const sink: OrchEventSink = {
    threadUpdated: (thread: AgentThread) => broadcast("agents:threadUpdated", thread),
    threadDelta: delta => broadcast("agents:threadDelta", delta),
    structuredDelta: delta => broadcast("agents:structuredDelta", delta),
    permissionRequest: payload => broadcast("agents:permissionRequest", payload),
  }

  const orchLayer = makeOrchestrationLive(sink)
  const orch = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* OrchestrationService
    }).pipe(Effect.provide(orchLayer)),
  )

  // Start idle reaper for pooled ACP clients.
  globalAcpPool.startReaper()

  const server = http.createServer((req, res) => {
    if (req.url === "/health" || req.url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ ok: true, service: "gharargah-agent-server", runtime: "effect" }))
      return
    }
    res.writeHead(404)
    res.end("not found")
  })

  const wss = new WebSocketServer({ server, path: "/agents" })
  wss.on("connection", ws => {
    const client: Client = { ws }
    clients.add(client)
    // PATH already enriched in bin.ts; only emit ready when shell env is ready.
    if (getShellEnvStatus() === "ready") {
      ws.send(JSON.stringify({ event: "agents:shellEnvReady", payload: null }))
    } else {
      ws.send(
        JSON.stringify({
          event: "agents:shellEnvReady",
          payload: { status: getShellEnvStatus() },
        }),
      )
    }
    ws.on("message", async raw => {
      let req: RpcRequest
      try {
        req = JSON.parse(String(raw)) as RpcRequest
      } catch {
        ws.send(JSON.stringify({ error: "invalid_json" }))
        return
      }
      try {
        const result = await handleRpc(orch, req.method, req.params)
        ws.send(JSON.stringify({ id: req.id, result }))
      } catch (err) {
        ws.send(
          JSON.stringify({
            id: req.id,
            error: err instanceof Error ? err.message : String(err),
          }),
        )
      }
    })
    ws.on("close", () => clients.delete(client))
  })

  await new Promise<void>((resolve, reject) => {
    server.listen(requestedPort, host, () => resolve())
    server.on("error", reject)
  })

  const address = server.address()
  const port =
    typeof address === "object" && address && "port" in address ? address.port : requestedPort

  return {
    host,
    port,
    close: async () => {
      await Effect.runPromise(orch.close())
      await globalAcpPool.closeAll()
      await closeMcpBridge().catch(() => undefined)
      await new Promise<void>((resolve, reject) => {
        wss.close(err => (err ? reject(err) : resolve()))
      })
      await new Promise<void>((resolve, reject) => {
        server.close(err => (err ? reject(err) : resolve()))
      })
    },
  }
}

type OrchHandle = {
  dispatch: (
    command: import("@gharargah/agents").OrchestrationCommand,
  ) => import("effect").Effect.Effect<unknown, import("../effect/errors.js").OrchError>
  listThreads: (
    workspaceRootUri: string,
    workspaceRootPath: string,
  ) => import("effect").Effect.Effect<unknown>
  readThread: (
    workspaceRootPath: string,
    threadId: string,
  ) => import("effect").Effect.Effect<AgentThread | null>
  listAgents: () => import("effect").Effect.Effect<unknown>
  refreshAgents: (
    providerId?: string,
  ) => import("effect").Effect.Effect<unknown, import("../effect/errors.js").OrchError>
  listProviders: () => import("effect").Effect.Effect<unknown>
  refreshProviders: (
    providerId?: string,
  ) => import("effect").Effect.Effect<unknown, import("../effect/errors.js").OrchError>
  close: () => import("effect").Effect.Effect<void>
}

async function handleRpc(
  engine: OrchHandle,
  method: string,
  params: unknown,
): Promise<unknown> {
  const p = asRecord(params)
  const args = Array.isArray(params) ? params : null

  switch (method) {
    case "health":
      return { ok: true, runtime: "effect" }
    case "agents:listThreads":
      return Effect.runPromise(
        engine.listThreads(
          String(args?.[0] ?? p.workspaceRootUri ?? ""),
          String(args?.[1] ?? p.workspaceRootPath ?? ""),
        ),
      )
    case "agents:readThread":
      return Effect.runPromise(
        engine.readThread(
          String(args?.[1] ?? p.workspaceRootPath ?? ""),
          String(args?.[2] ?? p.threadId ?? ""),
        ),
      )
    case "agents:createThread":
      return runOrch(
        engine.dispatch({
          type: "thread.create",
          commandId: String(p.commandId ?? crypto.randomUUID()),
          input: (args?.[0] ?? params) as import("@gharargah/agents").CreateAgentThreadInput,
        }),
      )
    case "agents:sendMessage": {
      const input = (args?.[0] ?? params) as import("@gharargah/agents").SendAgentMessageInput
      return runOrch(
        engine.dispatch({
          type: "thread.turn.start",
          commandId: String(input.commandId ?? crypto.randomUUID()),
          input,
        }),
      )
    }
    case "agents:interruptTurn": {
      const input = (args?.[0] ?? params) as import("@gharargah/agents").InterruptAgentTurnInput
      return runOrch(
        engine.dispatch({
          type: "thread.turn.interrupt",
          commandId: String(input.commandId ?? crypto.randomUUID()),
          input,
        }),
      )
    }
    case "agents:resolvePermission": {
      const input = (args?.[0] ?? params) as import("@gharargah/agents").ResolveAgentPermissionInput
      return runOrch(
        engine.dispatch({
          type: "thread.approval.respond",
          commandId: String(input.commandId ?? crypto.randomUUID()),
          input,
        }),
      )
    }
    case "agents:resolveUserInput": {
      const input = (args?.[0] ?? params) as import("@gharargah/agents").ResolveAgentUserInputInput
      return runOrch(
        engine.dispatch({
          type: "thread.userInput.respond",
          commandId: String(input.commandId ?? crypto.randomUUID()),
          input,
        }),
      )
    }
    case "agents:setArchived": {
      const input = (args?.[0] ?? params) as import("@gharargah/agents").SetAgentThreadArchivedInput
      return runOrch(
        engine.dispatch({
          type: "thread.archive",
          commandId: String(p.commandId ?? crypto.randomUUID()),
          input,
        }),
      )
    }
    case "agents:updateThreadSettings": {
      const input = (args?.[0] ??
        params) as import("@gharargah/agents").UpdateAgentThreadSettingsInput
      return runOrch(
        engine.dispatch({
          type: "thread.settings.update",
          commandId: String(p.commandId ?? crypto.randomUUID()),
          input,
        }),
      )
    }
    case "agents:createCheckpoint": {
      const input = (args?.[0] ?? params) as {
        workspaceRootPath: string
        threadId: string
        label?: string
      }
      return runOrch(
        engine.dispatch({
          type: "thread.checkpoint.create",
          commandId: String(p.commandId ?? crypto.randomUUID()),
          input,
        }),
      )
    }
    case "agents:revertCheckpoint": {
      const input = (args?.[0] ?? params) as {
        workspaceRootPath: string
        threadId: string
        checkpointId: string
      }
      return runOrch(
        engine.dispatch({
          type: "thread.checkpoint.revert",
          commandId: String(p.commandId ?? crypto.randomUUID()),
          input,
        }),
      )
    }
    case "agents:listAgents":
      return Effect.runPromise(engine.listAgents())
    case "agents:refreshAgents": {
      const providerId =
        typeof args?.[0] === "string"
          ? args[0]
          : typeof params === "string"
            ? params
            : typeof p.providerId === "string"
              ? p.providerId
              : undefined
      return Effect.runPromise(engine.refreshAgents(providerId))
    }
    case "agents:listProviders":
      return Effect.runPromise(engine.listProviders())
    case "agents:refreshProviders": {
      const providerId =
        typeof args?.[0] === "string"
          ? args[0]
          : typeof params === "string"
            ? params
            : typeof p.providerId === "string"
              ? p.providerId
              : undefined
      return Effect.runPromise(engine.refreshProviders(providerId))
    }
    case "thread.settle":
      return runOrch(
        engine.dispatch({
          type: "thread.settle",
          commandId: String(p.commandId ?? crypto.randomUUID()),
          workspaceRootPath: String(p.workspaceRootPath),
          threadId: String(p.threadId),
        }),
      )
    case "thread.snooze":
      return runOrch(
        engine.dispatch({
          type: "thread.snooze",
          commandId: String(p.commandId ?? crypto.randomUUID()),
          workspaceRootPath: String(p.workspaceRootPath),
          threadId: String(p.threadId),
        }),
      )
    case "agents:getConnectionState": {
      const input = (args?.[0] ?? params) as {
        providerId?: string
        workspaceRootPath?: string
        connectionKey?: string
      }
      return globalAcpPool.getConnectionState({
        providerId: input.providerId,
        workspaceRootPath: input.workspaceRootPath,
        connectionKey: input.connectionKey,
      })
    }
    case "agents:getAcpTrace": {
      const input = (args?.[0] ?? params) as {
        providerId?: string
        workspaceRootPath?: string
      }
      return globalAcpPool.getTrace({
        providerId: typeof input === "string" ? input : input.providerId,
        workspaceRootPath: typeof input === "object" ? input.workspaceRootPath : undefined,
      })
    }
    case "agents:authenticate": {
      const input = (args?.[0] ?? params) as {
        providerId?: string
        workspaceRootPath?: string
        methodId?: string
      }
      const methodId = input.methodId ?? "mock-token"
      const clients = globalAcpPool.listClients({
        workspaceRootPath: input.workspaceRootPath,
      })
      for (const client of clients) {
        await client.authenticate(methodId)
      }
      if (input.workspaceRootPath || input.providerId) {
        const keyHint = input.providerId ?? "effect"
        globalAcpPool.setConnectionState(
          input.workspaceRootPath
            ? `${keyHint}:default:${input.workspaceRootPath}`
            : keyHint,
          {
            status: "connected",
            message: null,
            providerId: input.providerId ?? "effect",
            updatedAt: new Date().toISOString(),
          },
        )
      }
      return { ok: true }
    }
    case "agents:setSessionConfigOption": {
      const input = (args?.[0] ?? params) as import("@gharargah/agents").SetAgentSessionConfigOptionInput
      const thread = await Effect.runPromise(
        engine.readThread(input.workspaceRootPath, input.threadId),
      )
      if (!thread?.acpSessionId) return null
      const driverId = thread.driverId ?? "cursor:acp"
      const instance = thread.providerInstanceId ?? thread.agentId ?? "default"
      const key = `${driverId}:${instance}:${thread.workspaceRootPath}`
      const client = globalAcpPool.get(key)
      if (!client) return null
      return client.setConfigOption(thread.acpSessionId, input.configId, input.value)
    }
    case "agents:forceStopProvider": {
      const input = (args?.[0] ?? params) as {
        connectionKey?: string
        providerId?: string
        workspaceRootPath?: string
      }
      const stopped = await globalAcpPool.forceStop(input)
      return { ok: true, stopped }
    }
    case "agents:listAcpSessions": {
      const input = (args?.[0] ?? params) as {
        connectionKey?: string
        providerId?: string
        workspaceRootPath?: string
      }
      return { sessions: globalAcpPool.listSessions(input) }
    }
    case "agents:closeAcpSession": {
      const input = (args?.[0] ?? params) as {
        connectionKey?: string
        providerId?: string
        workspaceRootPath?: string
        sessionId: string
      }
      const ok = await globalAcpPool.closeSession(input)
      return ok ? { ok: true } : null
    }
    case "agents:deleteAcpSession": {
      const input = (args?.[0] ?? params) as {
        connectionKey?: string
        providerId?: string
        workspaceRootPath?: string
        sessionId: string
      }
      const ok = await globalAcpPool.closeSession(input)
      return ok ? { ok: true } : null
    }
    case "agents:logoutProvider": {
      const input = (args?.[0] ?? params) as {
        connectionKey?: string
        providerId?: string
        workspaceRootPath?: string
      }
      const ok = await globalAcpPool.logout(input)
      return ok ? { ok: true } : null
    }
    default:
      throw new Error(`unknown method: ${method}`)
  }
}
