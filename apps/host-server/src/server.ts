import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import fs from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { Effect, ManagedRuntime, Schema } from "effect"
import { WebSocketServer, WebSocket } from "ws"
import { getLspSession, MAX_READ_BYTES, uriToPath, gitWorktreeAdd, gitWorktreeRemove } from "@yaade/node-host"
import {
  HostRpcRequest,
  InvalidRpcPayloadError,
  PathOutsideRootsError,
  encodeTerminalDataFrame,
  hostErrorHttpStatus,
  hostErrorWire,
  tryDecodeTerminalWsCommand,
  tryDecodeProjectSessionPayload,
  tryDecodeWorkspaceSession,
  type HostRpcError,
} from "@yaade/rpc"
import type { HostEvent } from "./events.js"
import type { HostConfig } from "./config.js"
import { dispatch } from "./dispatch.js"
import { makeHostLayers, type HostLayerServices } from "./effect/layers.js"
import { HostRuntimeTag } from "./effect/tags.js"
import { shutdownRuntime, type HostRuntime } from "./host-runtime.js"
import { parseSessionRosterBody } from "./persistence.js"
import { pathAllowed, pathStaysWithin } from "./sandbox.js"
import { isAllowedWebSocketOrigin } from "./security.js"
import { normalizeProviderHookRequest } from "./notifications/index.js"
import { resolveWorktreePath } from "./worktree-path.js"
import { pathToFileUri } from "@yaade/shared"

const VERSION = "0.0.1"
const MAX_JSON_BODY_BYTES = 2 * 1024 * 1024
const MAX_WEBSOCKET_BUFFERED_BYTES = 8 * 1024 * 1024
/** Bound concurrent /api/v1/rpc handlers to avoid stampede spikes. */
const MAX_INFLIGHT_RPC = 32

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

function runHostRpc(
  managed: ManagedRuntime.ManagedRuntime<HostLayerServices, never>,
  channel: string,
  args: unknown[],
  clientId: string,
): Promise<{ ok: true; value: unknown } | { ok: false; error: HostRpcError }> {
  return managed.runPromise(
    dispatch(channel, args, clientId).pipe(
      Effect.map(value => ({ ok: true as const, value })),
      Effect.catchAll(error => Effect.succeed({ ok: false as const, error })),
    ),
  )
}

export async function startHostServer(config: HostConfig): Promise<{
  runtime: HostRuntime
  close: () => Promise<void>
  port: number
}> {
  const hostLayer = makeHostLayers(config)
  /** Keeps the Layer scope open for the process lifetime (TerminalHost acquireRelease). */
  const managed = ManagedRuntime.make(hostLayer)
  const runtime = await managed.runPromise(
    Effect.gen(function* () {
      return yield* HostRuntimeTag
    }),
  )

  let inflightRpc = 0

  const server = createServer(async (req, res) => {
    try {
      await handleHttp(runtime, managed, req, res, {
        getInflightRpc: () => inflightRpc,
        beginRpc: () => {
          if (inflightRpc >= MAX_INFLIGHT_RPC) return false
          inflightRpc += 1
          return true
        },
        endRpc: () => {
          inflightRpc = Math.max(0, inflightRpc - 1)
        },
      })
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500
      sendJson(res, status, {
        error: { code: "OPERATION_FAILED", message: String(error), details: {} },
      })
    }
  })

  const wss = new WebSocketServer({ noServer: true })

  server.on("upgrade", (req, socket, head) => {
    if (!isAllowedWebSocketOrigin(req.headers.origin, req.headers.host)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n")
      socket.destroy()
      return
    }
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)
    if (url.pathname === "/ws") {
      wss.handleUpgrade(req, socket, head, ws => {
        handleEventSocket(runtime, managed, ws, url)
      })
      return
    }
    const lspMatch = /^\/ws\/lsp\/([^/]+)$/.exec(url.pathname)
    if (lspMatch) {
      wss.handleUpgrade(req, socket, head, ws => {
        handleLspProxy(lspMatch[1]!, ws)
      })
      return
    }
    socket.destroy()
  })

  const boundPort = await listenPreferringPort(server, config.host, config.port)
  config.port = boundPort

  console.log(`[host-server] listening on http://${config.host}:${config.port}`)

  let closePromise: Promise<void> | null = null
  const close = () => {
    closePromise ??= (async () => {
      shutdownRuntime(runtime)
      const serverClosed = new Promise<void>((resolve, reject) => {
        server.close(err => (err ? reject(err) : resolve()))
      })
      for (const client of wss.clients) client.terminate()
      await new Promise<void>(resolve => wss.close(() => resolve()))
      await serverClosed
      await managed.dispose()
    })()
    return closePromise
  }

  return { runtime, close, port: boundPort }
}

const PORT_FALLBACK_ATTEMPTS = 50

function isAddrInUse(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "EADDRINUSE"
  )
}

function listenOnPort(
  server: ReturnType<typeof createServer>,
  port: number,
  host: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening)
      reject(error)
    }
    const onListening = () => {
      server.off("error", onError)
      resolve()
    }
    server.once("error", onError)
    server.listen(port, host, onListening)
  })
}

async function closeServerQuietly(
  server: ReturnType<typeof createServer>,
): Promise<void> {
  await new Promise<void>(resolve => {
    server.close(() => resolve())
  })
}

/** Bind `preferredPort`, or the next free ports, instead of failing on EADDRINUSE. */
async function listenPreferringPort(
  server: ReturnType<typeof createServer>,
  host: string,
  preferredPort: number,
  maxAttempts = PORT_FALLBACK_ATTEMPTS,
): Promise<number> {
  let port = preferredPort
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await listenOnPort(server, port, host)
      const address = server.address()
      const bound =
        address && typeof address === "object" ? address.port : port
      if (bound !== preferredPort) {
        console.warn(
          `[host-server] port ${preferredPort} busy; listening on ${bound}`,
        )
      }
      return bound
    } catch (error) {
      if (!isAddrInUse(error)) throw error
      await closeServerQuietly(server)
      port += 1
    }
  }
  throw new Error(
    `Could not bind host-server near port ${preferredPort} after ${maxAttempts} attempts`,
  )
}

type RpcGate = {
  getInflightRpc: () => number
  beginRpc: () => boolean
  endRpc: () => void
}

async function handleHttp(
  runtime: HostRuntime,
  managed: ManagedRuntime.ManagedRuntime<HostLayerServices, never>,
  req: IncomingMessage,
  res: ServerResponse,
  rpcGate: RpcGate,
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)
  const { pathname } = url

  if (req.method === "GET" && pathname === "/health") {
    sendJson(res, 200, { status: "ok", version: VERSION })
    return
  }

  if (req.method === "GET" && pathname === "/api/v1/system") {
    sendJson(res, 200, {
      name: "YAADE",
      version: VERSION,
      protocolVersion: 1,
      launchConfig: runtime.config.launchConfig,
      homeDir: runtime.homeDir,
      machineHostname: runtime.machineHostname,
    })
    return
  }

  if (req.method === "POST" && pathname === "/api/v1/rpc") {
    if (!rpcGate.beginRpc()) {
      sendJson(res, 503, {
        error: {
          code: "HOST_BUSY",
          message: `too many in-flight RPCs (max ${MAX_INFLIGHT_RPC})`,
          details: { inflight: rpcGate.getInflightRpc() },
        },
      })
      return
    }
    try {
      const body = await readJson(req)
      const decoded = Schema.decodeUnknownEither(HostRpcRequest)(body)
      if (decoded._tag === "Left") {
        const error = new InvalidRpcPayloadError({
          message: "invalid rpc body",
          cause: decoded.left,
        })
        const wire = hostErrorWire(error)
        sendJson(res, hostErrorHttpStatus(error), { error: wire })
        return
      }
      const { channel, args, clientId } = decoded.right
      const rpcArgs = [...args]
      const pathError = validateRpcPaths(runtime.config, channel, rpcArgs)
      if (pathError) {
        const wire = hostErrorWire(pathError)
        sendJson(res, hostErrorHttpStatus(pathError), { error: wire })
        return
      }
      const result = await runHostRpc(managed, channel, rpcArgs, clientId)
      if (result.ok) {
        sendJson(res, 200, { value: result.value })
        return
      }
      const wire = hostErrorWire(result.error)
      sendJson(res, hostErrorHttpStatus(result.error), { error: wire })
    } finally {
      rpcGate.endRpc()
    }
    return
  }

  // Provider hooks (Claude / Codex / Cursor / OpenCode) → ADE agent events.
  if (req.method === "POST" && pathname === "/api/v1/notifications/ingest") {
    const body = await readJson(req)
    try {
      const providerParam = url.searchParams.get("provider")
      const sessionIdParam = url.searchParams.get("sessionId")
      const { parseAgentProviderParam } = await import("./agents/index.js")
      const agentProvider = parseAgentProviderParam(providerParam)
      if (agentProvider && sessionIdParam) {
        runtime.agents.ingestNative(body, {
          provider: agentProvider,
          sessionId: sessionIdParam,
          projectId: url.searchParams.get("projectId") ?? undefined,
          projectName: url.searchParams.get("projectName") ?? undefined,
          sessionTitle: url.searchParams.get("sessionTitle") ?? undefined,
        })
        res.writeHead(204)
        res.end()
        return
      }
      const normalized = normalizeProviderHookRequest(body, {
        provider: providerParam,
        sessionId: sessionIdParam,
        projectId: url.searchParams.get("projectId"),
        projectName: url.searchParams.get("projectName"),
        sessionTitle: url.searchParams.get("sessionTitle"),
      })
      const ingest = await runHostRpc(managed, "notifications:ingest", [normalized], "hook")
      if (!ingest.ok) {
        const wire = hostErrorWire(ingest.error)
        sendJson(res, hostErrorHttpStatus(ingest.error), { error: wire })
        return
      }
      // Hook consumers interpret response bodies as control output. An empty 2xx
      // acknowledges delivery without accidentally feeding Yaade data back
      // into the provider's conversation.
      res.writeHead(204)
      res.end()
    } catch (error) {
      sendJson(res, 400, {
        error: {
          code: "OPERATION_FAILED",
          message: error instanceof Error ? error.message : String(error),
          details: {},
        },
      })
    }
    return
  }

  if (pathname === "/api/v1/sessions") {
    if (req.method === "GET") {
      sendJson(res, 200, runtime.db.getSessionRoster())
      return
    }
    if (req.method === "PUT") {
      const body = await readJson(req)
      const roster = parseSessionRosterBody(body)
      if (!roster) {
        sendJson(res, 400, {
          error: {
            code: "INVALID_SESSION_ROSTER",
            message: "session roster body invalid",
            details: {},
          },
        })
        return
      }
      try {
        const saved = runtime.db.replaceSessionRoster(roster)
        sendJson(res, 200, saved)
      } catch (error) {
        sendJson(res, 400, {
          error: {
            code: "INVALID_SESSION_ROSTER",
            message: error instanceof Error ? error.message : String(error),
            details: {},
          },
        })
      }
      return
    }
  }

  if (pathname === "/api/v1/workspace-session") {
    if (req.method === "GET") {
      const root = url.searchParams.get("root")?.trim() ?? ""
      if (!root) {
        sendJson(res, 400, {
          error: {
            code: "INVALID_WORKSPACE_ROOT",
            message: "root query parameter required",
            details: {},
          },
        })
        return
      }
      if (!pathAllowed(root, runtime.config.allowedRoots)) {
        sendJson(res, 403, {
          error: {
            code: "PATH_OUTSIDE_ALLOWED_ROOTS",
            message: "workspace root outside allowed roots",
            details: {},
          },
        })
        return
      }
      sendJson(
        res,
        200,
        runtime.db.getWorkspaceSession(runtime.machineHostname, root),
      )
      return
    }
    if (req.method === "PUT") {
      const body = await readJson(req)
      const parsed = tryDecodeWorkspaceSession(body)
      if (!parsed) {
        sendJson(res, 400, {
          error: {
            code: "INVALID_WORKSPACE_SESSION",
            message: "workspace session body invalid",
            details: {},
          },
        })
        return
      }
      if (!pathAllowed(parsed.rootPath, runtime.config.allowedRoots)) {
        sendJson(res, 403, {
          error: {
            code: "PATH_OUTSIDE_ALLOWED_ROOTS",
            message: "workspace root outside allowed roots",
            details: {},
          },
        })
        return
      }
      try {
        const saved = runtime.db.replaceWorkspaceSession({
          ...parsed,
          machine: runtime.machineHostname,
        })
        sendJson(res, 200, saved)
      } catch (error) {
        sendJson(res, 400, {
          error: {
            code: "INVALID_WORKSPACE_SESSION",
            message: error instanceof Error ? error.message : String(error),
            details: {},
          },
        })
      }
      return
    }
  }

  if (pathname === "/api/v1/project-sessions") {
    if (req.method === "GET") {
      const root = url.searchParams.get("root")?.trim() ?? ""
      if (!root) {
        sendJson(res, 400, {
          error: {
            code: "INVALID_PROJECT_ROOT",
            message: "root query parameter required",
            details: {},
          },
        })
        return
      }
      if (!pathAllowed(root, runtime.config.allowedRoots)) {
        sendJson(res, 403, {
          error: {
            code: "PATH_OUTSIDE_ALLOWED_ROOTS",
            message: "project root outside allowed roots",
            details: {},
          },
        })
        return
      }
      sendJson(
        res,
        200,
        runtime.db.listProjectSessions(runtime.machineHostname, root),
      )
      return
    }
    if (req.method === "POST") {
      const body = (await readJson(req)) as {
        rootPath?: string
        title?: string
        worktree?: { branch?: string; baseRef?: string; createBranch?: boolean }
      }
      const rootPath = typeof body.rootPath === "string" ? body.rootPath.trim() : ""
      if (!rootPath) {
        sendJson(res, 400, {
          error: {
            code: "INVALID_PROJECT_ROOT",
            message: "rootPath required",
            details: {},
          },
        })
        return
      }
      if (!pathAllowed(rootPath, runtime.config.allowedRoots)) {
        sendJson(res, 403, {
          error: {
            code: "PATH_OUTSIDE_ALLOWED_ROOTS",
            message: "project root outside allowed roots",
            details: {},
          },
        })
        return
      }

      let cwdPath = rootPath
      let worktreeBranch: string | null = null
      let worktreePath: string | null = null
      const worktree = body.worktree
      if (worktree && typeof worktree.branch === "string" && worktree.branch.trim()) {
        const branch = worktree.branch.trim()
        try {
          worktreePath = resolveWorktreePath({
            homeDir: runtime.homeDir,
            projectPath: rootPath,
            branch,
          })
        } catch (error) {
          sendJson(res, 400, {
            error: {
              code: "INVALID_WORKTREE",
              message: error instanceof Error ? error.message : String(error),
              details: {},
            },
          })
          return
        }
        if (!pathAllowed(worktreePath, runtime.config.allowedRoots)) {
          sendJson(res, 403, {
            error: {
              code: "PATH_OUTSIDE_ALLOWED_ROOTS",
              message: "worktree path outside allowed roots",
              details: {},
            },
          })
          return
        }
        try {
          fs.mkdirSync(path.dirname(worktreePath), { recursive: true })
          await gitWorktreeAdd(pathToFileUri(rootPath), worktreePath, {
            branch,
            baseRef:
              typeof worktree.baseRef === "string" && worktree.baseRef.trim()
                ? worktree.baseRef.trim()
                : undefined,
            createBranch: worktree.createBranch !== false,
          })
          cwdPath = worktreePath
          worktreeBranch = branch
        } catch (error) {
          sendJson(res, 400, {
            error: {
              code: "WORKTREE_CREATE_FAILED",
              message: error instanceof Error ? error.message : String(error),
              details: {},
            },
          })
          return
        }
      }

      try {
        const created = runtime.db.createProjectSession({
          machine: runtime.machineHostname,
          projectPath: rootPath,
          cwdPath,
          title:
            typeof body.title === "string" && body.title.trim()
              ? body.title.trim()
              : worktreeBranch
                ? worktreeBranch
                : "Session",
          worktreeBranch,
          worktreePath,
        })
        sendJson(res, 201, created)
      } catch (error) {
        if (worktreePath) {
          try {
            await gitWorktreeRemove(pathToFileUri(rootPath), worktreePath, {
              force: true,
            })
          } catch {
            /* best-effort cleanup */
          }
        }
        sendJson(res, 400, {
          error: {
            code: "INVALID_PROJECT_SESSION",
            message: error instanceof Error ? error.message : String(error),
            details: {},
          },
        })
      }
      return
    }
  }

  const projectSessionMatch = pathname.match(
    /^\/api\/v1\/project-sessions\/([^/]+)$/,
  )
  if (projectSessionMatch) {
    const sessionId = decodeURIComponent(projectSessionMatch[1] ?? "")
    if (req.method === "GET") {
      const session = runtime.db.getProjectSession(sessionId)
      if (!session) {
        sendJson(res, 404, {
          error: {
            code: "PROJECT_SESSION_NOT_FOUND",
            message: "project session not found",
            details: {},
          },
        })
        return
      }
      if (
        !pathAllowed(session.projectPath, runtime.config.allowedRoots) ||
        !pathAllowed(session.cwdPath, runtime.config.allowedRoots)
      ) {
        sendJson(res, 403, {
          error: {
            code: "PATH_OUTSIDE_ALLOWED_ROOTS",
            message: "project session path outside allowed roots",
            details: {},
          },
        })
        return
      }
      sendJson(res, 200, session)
      return
    }
    if (req.method === "PUT") {
      const body = (await readJson(req)) as {
        title?: string
        archived?: boolean
        payload?: unknown
      }
      const existing = runtime.db.getProjectSession(sessionId)
      if (!existing) {
        sendJson(res, 404, {
          error: {
            code: "PROJECT_SESSION_NOT_FOUND",
            message: "project session not found",
            details: {},
          },
        })
        return
      }
      if (
        !pathAllowed(existing.projectPath, runtime.config.allowedRoots) ||
        !pathAllowed(existing.cwdPath, runtime.config.allowedRoots)
      ) {
        sendJson(res, 403, {
          error: {
            code: "PATH_OUTSIDE_ALLOWED_ROOTS",
            message: "project session path outside allowed roots",
            details: {},
          },
        })
        return
      }
      try {
        let updated = existing
        if (typeof body.title === "string") {
          updated = runtime.db.renameProjectSession(sessionId, body.title)
        }
        if (typeof body.archived === "boolean") {
          updated = runtime.db.archiveProjectSession(sessionId, body.archived)
        }
        if (body.payload !== undefined) {
          const payload = tryDecodeProjectSessionPayload(body.payload)
          if (!payload) {
            sendJson(res, 400, {
              error: {
                code: "INVALID_PROJECT_SESSION",
                message: "project session payload invalid",
                details: {},
              },
            })
            return
          }
          updated = runtime.db.updateProjectSessionPayload(sessionId, payload)
        } else if (body.title === undefined && body.archived === undefined) {
          updated = runtime.db.touchProjectSession(sessionId)
        }
        sendJson(res, 200, updated)
      } catch (error) {
        sendJson(res, 400, {
          error: {
            code: "INVALID_PROJECT_SESSION",
            message: error instanceof Error ? error.message : String(error),
            details: {},
          },
        })
      }
      return
    }
    if (req.method === "DELETE") {
      const existing = runtime.db.getProjectSession(sessionId)
      if (!existing) {
        sendJson(res, 404, {
          error: {
            code: "PROJECT_SESSION_NOT_FOUND",
            message: "project session not found",
            details: {},
          },
        })
        return
      }
      if (
        !pathAllowed(existing.projectPath, runtime.config.allowedRoots) ||
        !pathAllowed(existing.cwdPath, runtime.config.allowedRoots)
      ) {
        sendJson(res, 403, {
          error: {
            code: "PATH_OUTSIDE_ALLOWED_ROOTS",
            message: "project session path outside allowed roots",
            details: {},
          },
        })
        return
      }
      const removeWorktree = url.searchParams.get("removeWorktree") === "1"
      if (removeWorktree && existing.worktreePath) {
        try {
          await gitWorktreeRemove(
            pathToFileUri(existing.projectPath),
            existing.worktreePath,
            { force: true },
          )
        } catch (error) {
          sendJson(res, 400, {
            error: {
              code: "WORKTREE_REMOVE_FAILED",
              message: error instanceof Error ? error.message : String(error),
              details: {},
            },
          })
          return
        }
      }
      runtime.db.deleteProjectSession(sessionId)
      sendJson(res, 200, { ok: true })
      return
    }
  }

  if (pathname === "/api/v1/projects") {
    if (req.method === "GET") {
      sendJson(res, 200, runtime.db.projects())
      return
    }
    if (req.method === "POST") {
      const body = (await readJson(req)) as { rootPath?: string; name?: string }
      if (!body.rootPath) {
        sendJson(res, 400, {
          error: { code: "INVALID_PROJECT_PATH", message: "rootPath required", details: {} },
        })
        return
      }
      if (!pathAllowed(body.rootPath, runtime.config.allowedRoots)) {
        sendJson(res, 403, {
          error: {
            code: "PATH_OUTSIDE_ALLOWED_ROOTS",
            message: "project path outside allowed roots",
            details: {},
          },
        })
        return
      }
      try {
        const project = runtime.db.addProject(body.rootPath, body.name)
        sendJson(res, 201, project)
      } catch (error) {
        sendJson(res, 400, {
          error: { code: "INVALID_PROJECT_PATH", message: String(error), details: {} },
        })
      }
      return
    }
  }

  const projectMatch = /^\/api\/v1\/projects\/([^/]+)(?:\/(file|files))?$/.exec(pathname)
  if (projectMatch) {
    const projectId = decodeURIComponent(projectMatch[1]!)
    const sub = projectMatch[2]
    const project = runtime.db.project(projectId)
    if (!project) {
      sendJson(res, 404, {
        error: { code: "PROJECT_NOT_FOUND", message: "project not found", details: {} },
      })
      return
    }

    if (!sub && req.method === "DELETE") {
      runtime.db.removeProject(projectId)
      res.writeHead(204)
      res.end()
      return
    }

    if (sub === "files" && req.method === "GET") {
      const rel = url.searchParams.get("path") ?? ""
      const abs = pathStaysWithin(project.rootPath, rel || ".")
      if (!abs || !pathAllowed(abs, runtime.config.allowedRoots)) {
        sendJson(res, 403, {
          error: { code: "PATH_TRAVERSAL", message: "invalid path", details: {} },
        })
        return
      }
      try {
        const entries = fs
          .readdirSync(abs, { withFileTypes: true })
          .map(entry => ({ name: entry.name, isDirectory: entry.isDirectory() }))
          .sort((a, b) => a.name.localeCompare(b.name))
        sendJson(res, 200, entries)
      } catch {
        sendJson(res, 404, {
          error: { code: "FILE_NOT_FOUND", message: "directory not found", details: {} },
        })
      }
      return
    }

    if (sub === "file") {
      const rel = url.searchParams.get("path") ?? ""
      if (req.method === "GET") {
        const abs = pathStaysWithin(project.rootPath, rel)
        if (!abs || !pathAllowed(abs, runtime.config.allowedRoots)) {
          sendJson(res, 403, {
            error: { code: "PATH_TRAVERSAL", message: "invalid path", details: {} },
          })
          return
        }
        try {
          const st = fs.statSync(abs)
          if (st.isDirectory()) {
            sendJson(res, 404, {
              error: { code: "FILE_NOT_FOUND", message: "not a file", details: {} },
            })
            return
          }
          if (st.size > MAX_READ_BYTES) {
            sendJson(res, 413, {
              error: {
                code: "FILE_TOO_LARGE",
                message: `file too large: ${st.size} bytes (max ${MAX_READ_BYTES})`,
                details: { size: st.size, max: MAX_READ_BYTES },
              },
            })
            return
          }
          const content = fs.readFileSync(abs, "utf8")
          sendJson(res, 200, { path: rel, content, version: fileVersion(abs) })
        } catch {
          sendJson(res, 404, {
            error: { code: "FILE_NOT_FOUND", message: "file not found", details: {} },
          })
        }
        return
      }
      if (req.method === "PUT") {
        const body = (await readJson(req)) as {
          path?: string
          content?: string
          expectedVersion?: string
        }
        const fileRel = body.path ?? rel
        const abs = pathStaysWithin(project.rootPath, fileRel ?? "")
        if (!abs || !pathAllowed(abs, runtime.config.allowedRoots)) {
          sendJson(res, 403, {
            error: { code: "PATH_TRAVERSAL", message: "invalid path", details: {} },
          })
          return
        }
        if (body.expectedVersion && body.expectedVersion !== fileVersion(abs)) {
          sendJson(res, 409, {
            error: { code: "FILE_CHANGED", message: "file changed on disk", details: {} },
          })
          return
        }
        const tmp = `${abs}.jet-write-${randomUUID()}`
        fs.mkdirSync(path.dirname(abs), { recursive: true })
        fs.writeFileSync(tmp, body.content ?? "", "utf8")
        fs.renameSync(tmp, abs)
        sendJson(res, 200, { path: fileRel, version: fileVersion(abs) })
        return
      }
    }
  }

  if (req.method === "GET" && runtime.config.staticDir) {
    if (serveStatic(runtime.config.staticDir, pathname, res)) return
  }

  sendJson(res, 404, {
    error: { code: "NOT_FOUND", message: `no route ${pathname}`, details: {} },
  })
}

function handleEventSocket(
  runtime: HostRuntime,
  managed: ManagedRuntime.ManagedRuntime<HostLayerServices, never>,
  ws: WebSocket,
  url: URL,
): void {
  const since = Number(url.searchParams.get("since") ?? "0") || 0
  const clientId = `ws-${randomUUID()}`
  for (const event of runtime.events.replayAfter(since)) {
    sendEventSocketMessage(ws, event)
  }
  const unsubscribe = runtime.events.subscribe(event => {
    sendEventSocketMessage(ws, event)
  })
  ws.on("message", data => {
    // Hot terminal control is JSON text; binary frames are host→client only.
    const text = typeof data === "string" ? data : wsDataToText(data)
    if (text === "ping") {
      ws.send("pong")
      return
    }
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      return
    }
    const cmd = tryDecodeTerminalWsCommand(raw)
    if (!cmd) return
    void runHostRpc(managed, cmd.op, cmd.args, clientId)
  })
  ws.on("close", () => unsubscribe())
}

function sendEventSocketMessage(ws: WebSocket, event: HostEvent): void {
  if (ws.readyState !== WebSocket.OPEN) return
  if (ws.bufferedAmount > MAX_WEBSOCKET_BUFFERED_BYTES) {
    ws.close(1013, "client is not consuming events")
    return
  }
  if (event.channel === "terminal:data") {
    const id = String(event.args[0] ?? "")
    const data = String(event.args[1] ?? "")
    const terminalSequence =
      typeof event.args[2] === "number" && Number.isFinite(event.args[2])
        ? event.args[2]
        : 0
    try {
      ws.send(
        Buffer.from(
          encodeTerminalDataFrame(event.sequence, terminalSequence, id, data),
        ),
      )
      return
    } catch {
      // Fall through to JSON if encoding fails (oversized id, etc.).
    }
  }
  ws.send(JSON.stringify(event))
}

/** Coerce ws payloads to UTF-8 text. Browser JSON-RPC readers call JSON.parse on
 *  message data; binary frames become Blob/ArrayBuffer and hang initialize. */
function wsDataToText(data: WebSocket.RawData): string {
  if (typeof data === "string") return data
  if (Buffer.isBuffer(data)) return data.toString("utf8")
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8")
  return Buffer.from(data).toString("utf8")
}

function handleLspProxy(id: string, client: WebSocket): void {
  const session = getLspSession(id)
  if (!session) {
    client.close()
    return
  }
  const upstream = new WebSocket(`ws://127.0.0.1:${session.port}`)
  const pending: string[] = []
  upstream.on("open", () => {
    for (const msg of pending) upstream.send(msg)
    pending.length = 0
  })
  client.on("message", data => {
    const text = wsDataToText(data)
    if (upstream.readyState === WebSocket.OPEN) upstream.send(text)
    else if (pending.length < 256) pending.push(text)
  })
  upstream.on("message", data => {
    if (client.readyState === WebSocket.OPEN) client.send(wsDataToText(data))
  })
  const closeBoth = () => {
    try {
      client.close()
    } catch {
      /* ignore */
    }
    try {
      upstream.close()
    } catch {
      /* ignore */
    }
  }
  client.on("close", closeBoth)
  upstream.on("close", closeBoth)
  upstream.on("error", closeBoth)
  client.on("error", closeBoth)
}
function validateRpcPaths(
  config: HostConfig,
  channel: string,
  args: unknown[],
): PathOutsideRootsError | null {
  try {
    validateRpcPathsOrThrow(config, channel, args)
    return null
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new PathOutsideRootsError({ message })
  }
}

function validateRpcPathsOrThrow(config: HostConfig, channel: string, args: unknown[]): void {
  if (channel.startsWith("agents:")) {
    const first = args[0]
    if (first && typeof first === "object") {
      const obj = first as { workspaceRootPath?: string; workspaceRootUri?: string }
      const candidate = obj.workspaceRootPath ?? obj.workspaceRootUri
      if (candidate && !pathAllowed(uriOrPath(candidate), config.allowedRoots)) {
        throw new Error("PATH_OUTSIDE_ALLOWED_ROOTS")
      }
    }
    return
  }
  if (channel === "tasks:spawn") {
    const cwd = (args[0] as { cwd?: string } | undefined)?.cwd
    if (cwd && !pathAllowed(cwd, config.allowedRoots)) throw new Error("PATH_OUTSIDE_ALLOWED_ROOTS")
    return
  }
  if (channel.startsWith("notifications:")) return
  if (!/^(fs|git|search|workspace|lsp|terminal):/.test(channel)) return
  if (channel === "fs:writeTempDrop") return
  if (channel.startsWith("terminal:") && typeof args[0] === "string" && !args[0].startsWith("file:")) {
    return
  }
  const first = args[0]
  if (typeof first !== "string") return
  if (!pathAllowed(uriOrPath(first), config.allowedRoots)) {
    throw new Error("PATH_OUTSIDE_ALLOWED_ROOTS")
  }
}

function uriOrPath(value: string): string {
  return value.startsWith("file:") ? uriToPath(value) : value
}

function fileVersion(abs: string): string {
  try {
    const st = fs.statSync(abs)
    return `${Math.trunc(st.mtimeMs * 1e6)}:${st.size}`
  } catch {
    return "missing"
  }
}

function serveStatic(root: string, pathname: string, res: ServerResponse): boolean {
  const rel = pathname === "/" ? "/index.html" : pathname
  const abs = path.join(root, rel)
  if (!abs.startsWith(root)) return false
  let filePath = abs
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(root, "index.html")
    if (!fs.existsSync(filePath)) return false
  }
  const ext = path.extname(filePath)
  const type =
    ext === ".html"
      ? "text/html"
      : ext === ".js"
        ? "text/javascript"
        : ext === ".css"
          ? "text/css"
          : ext === ".svg"
            ? "image/svg+xml"
            : ext === ".json"
              ? "application/json"
              : "application/octet-stream"
  res.writeHead(200, { "content-type": type })
  fs.createReadStream(filePath).pipe(res)
  return true
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let totalBytes = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    totalBytes += buffer.length
    if (totalBytes > MAX_JSON_BODY_BYTES) {
      throw new HttpError(413, "request body too large")
    }
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString("utf8"))
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  })
  res.end(payload)
}
