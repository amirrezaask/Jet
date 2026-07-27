/**
 * Loopback HTTP MCP bridge injected into ACP session/new|load (t3code / Rust parity).
 * Tools: gharargah_ping, gharargah_workspace_root.
 */
import http from "node:http"
import { randomUUID } from "node:crypto"

type BridgeHandle = {
  endpoint: string
  token: string
  workspaceRoot: string | null
  server: http.Server
}

let bridge: BridgeHandle | null = null

function jsonRpc(id: unknown, result: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id: id ?? null, result })
}

function jsonRpcError(id: unknown, code: number, message: string): string {
  return JSON.stringify({ jsonrpc: "2.0", id: id ?? null, error: { code, message } })
}

function spawnBridge(): BridgeHandle {
  const token = randomUUID()
  const handle: BridgeHandle = {
    endpoint: "",
    token,
    workspaceRoot: null,
    server: null as unknown as http.Server,
  }

  const server = http.createServer((req, res) => {
    const url = req.url ?? "/"
    if (req.method !== "POST" || (url !== "/" && url !== "/mcp" && !url.startsWith("/mcp?"))) {
      res.writeHead(404)
      res.end()
      return
    }
    const chunks: Buffer[] = []
    req.on("data", c => chunks.push(c))
    req.on("end", () => {
      const auth = req.headers.authorization ?? ""
      if (auth !== `Bearer ${token}`) {
        res.writeHead(401, { "content-type": "application/json" })
        res.end(jsonRpcError(null, -32001, "unauthorized"))
        return
      }
      let request: { id?: unknown; method?: string; params?: { name?: string } }
      try {
        request = JSON.parse(Buffer.concat(chunks).toString("utf8")) as typeof request
      } catch {
        res.writeHead(400, { "content-type": "application/json" })
        res.end(jsonRpcError(null, -32700, "parse error"))
        return
      }
      const id = request.id ?? null
      const method = request.method ?? ""
      if (method === "notifications/initialized" || method === "initialized") {
        res.writeHead(202)
        res.end()
        return
      }
      let result: unknown
      switch (method) {
        case "initialize":
          result = {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "gharargah", version: "0.0.1" },
          }
          break
        case "ping":
          result = {}
          break
        case "tools/list":
          result = {
            tools: [
              {
                name: "gharargah_ping",
                description: "Health check for the Gharargah host MCP bridge",
                inputSchema: { type: "object", properties: {} },
              },
              {
                name: "gharargah_workspace_root",
                description: "Return the workspace root bound to the current ACP session",
                inputSchema: { type: "object", properties: {} },
              },
            ],
          }
          break
        case "tools/call": {
          const name = request.params?.name ?? ""
          if (name === "gharargah_ping") {
            result = { content: [{ type: "text", text: "pong" }] }
          } else if (name === "gharargah_workspace_root") {
            result = {
              content: [{ type: "text", text: handle.workspaceRoot ?? "" }],
            }
          } else {
            res.writeHead(200, { "content-type": "application/json" })
            res.end(jsonRpcError(id, -32601, `unknown tool: ${name}`))
            return
          }
          break
        }
        default:
          res.writeHead(200, { "content-type": "application/json" })
          res.end(jsonRpcError(id, -32601, `unknown method: ${method}`))
          return
      }
      res.writeHead(200, { "content-type": "application/json" })
      res.end(jsonRpc(id, result))
    })
  })

  server.listen(0, "127.0.0.1")
  const addr = server.address()
  const port = typeof addr === "object" && addr ? addr.port : 0
  handle.endpoint = `http://127.0.0.1:${port}/mcp`
  handle.server = server
  return handle
}

/** ACP `mcpServers` list for session/new|load|resume. */
export function ensureMcpServers(workspaceRoot?: string | null): unknown[] {
  if (process.env.GHARARGAH_AGENT_MOCK === "1") {
    return [
      {
        name: "gharargah-mock",
        command: "/usr/bin/true",
        args: [],
        env: [],
      },
    ]
  }
  if (!bridge) {
    try {
      bridge = spawnBridge()
    } catch (err) {
      console.warn("[mcp-bridge] failed to start:", err)
      return []
    }
  }
  if (workspaceRoot) bridge.workspaceRoot = workspaceRoot
  return [
    {
      type: "http",
      name: "gharargah",
      url: bridge.endpoint,
      headers: [{ name: "Authorization", value: `Bearer ${bridge.token}` }],
    },
  ]
}

export async function closeMcpBridge(): Promise<void> {
  if (!bridge) return
  const b = bridge
  bridge = null
  await new Promise<void>((resolve, reject) => {
    b.server.close(err => (err ? reject(err) : resolve()))
  })
}
