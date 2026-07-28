import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import fs from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { WebSocketServer, WebSocket } from "ws"
import { getLspSession, uriToPath } from "@gharargah/node-host"
import type { HostConfig } from "./config.js"
import { createRuntime, dispatch, shutdownRuntime, type HostRuntime } from "./dispatch.js"
import { EventHub } from "./events.js"
import { parseSessionRosterBody, ProjectDatabase } from "./persistence.js"
import { pathAllowed, pathStaysWithin } from "./sandbox.js"

const VERSION = "0.0.1"

type RpcBody = {
  channel?: string
  args?: unknown[]
  clientId?: string
}

export async function startHostServer(config: HostConfig): Promise<{
  runtime: HostRuntime
  close: () => Promise<void>
}> {
  const events = new EventHub(1024)
  const db = new ProjectDatabase(path.join(config.dataDir, "jet.sqlite3"))
  const runtime = createRuntime(config, events, db)

  const server = createServer(async (req, res) => {
    try {
      await handleHttp(runtime, req, res)
    } catch (error) {
      sendJson(res, 500, {
        error: { code: "OPERATION_FAILED", message: String(error), details: {} },
      })
    }
  })

  const wss = new WebSocketServer({ noServer: true })

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)
    if (url.pathname === "/ws") {
      wss.handleUpgrade(req, socket, head, ws => {
        handleEventSocket(runtime, ws, url)
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

  await new Promise<void>((resolve, reject) => {
    server.listen(config.port, config.host, () => resolve())
    server.on("error", reject)
  })

  console.log(`[host-server] listening on http://${config.host}:${config.port}`)

  const close = async () => {
    shutdownRuntime(runtime)
    db.close()
    await new Promise<void>(resolve => wss.close(() => resolve()))
    await new Promise<void>((resolve, reject) => {
      server.close(err => (err ? reject(err) : resolve()))
    })
  }

  return { runtime, close }
}

async function handleHttp(
  runtime: HostRuntime,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)
  const { pathname } = url

  if (req.method === "GET" && pathname === "/health") {
    sendJson(res, 200, { status: "ok", version: VERSION })
    return
  }

  if (req.method === "GET" && pathname === "/api/v1/system") {
    sendJson(res, 200, {
      name: "Jet",
      version: VERSION,
      protocolVersion: 1,
      launchConfig: runtime.config.launchConfig,
      homeDir: runtime.homeDir,
    })
    return
  }

  if (req.method === "POST" && pathname === "/api/v1/rpc") {
    const body = (await readJson(req)) as RpcBody
    const channel = body.channel ?? ""
    const args = Array.isArray(body.args) ? body.args : []
    const clientId = typeof body.clientId === "string" ? body.clientId : "browser"
    try {
      validateRpcPaths(runtime.config, channel, args)
      const value = await dispatch(runtime, channel, args, clientId)
      sendJson(res, 200, { value })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const code = message.includes("not allowed") || message.includes("PATH_OUTSIDE")
        ? "PATH_OUTSIDE_ALLOWED_ROOTS"
        : message.startsWith("unknown")
          ? "UNKNOWN_OPERATION"
          : "OPERATION_FAILED"
      const status = code === "PATH_OUTSIDE_ALLOWED_ROOTS" ? 403 : 400
      sendJson(res, status, { error: { code, message, details: {} } })
    }
    return
  }

  // Provider hooks (Claude Stop / Codex / etc.) POST semantic events here.
  if (req.method === "POST" && pathname === "/api/v1/notifications/ingest") {
    const body = (await readJson(req)) as Record<string, unknown>
    try {
      const value = await dispatch(runtime, "notifications:ingest", [body], "hook")
      sendJson(res, 200, { value })
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

function handleEventSocket(runtime: HostRuntime, ws: WebSocket, url: URL): void {
  const since = Number(url.searchParams.get("since") ?? "0") || 0
  for (const event of runtime.events.replayAfter(since)) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event))
  }
  const unsubscribe = runtime.events.subscribe(event => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event))
  })
  ws.on("message", data => {
    if (String(data) === "ping") ws.send("pong")
  })
  ws.on("close", () => unsubscribe())
}

function handleLspProxy(id: string, client: WebSocket): void {
  const session = getLspSession(id)
  if (!session) {
    client.close()
    return
  }
  const upstream = new WebSocket(`ws://127.0.0.1:${session.port}`)
  const pending: WebSocket.RawData[] = []
  upstream.on("open", () => {
    for (const msg of pending) upstream.send(msg)
    pending.length = 0
  })
  client.on("message", data => {
    if (upstream.readyState === WebSocket.OPEN) upstream.send(data)
    else if (pending.length < 256) pending.push(data)
  })
  upstream.on("message", data => {
    if (client.readyState === WebSocket.OPEN) client.send(data)
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

function validateRpcPaths(config: HostConfig, channel: string, args: unknown[]): void {
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
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
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
