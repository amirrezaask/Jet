import http from "node:http"
import { WebSocketServer, type WebSocket } from "ws"
import {
  registerHostRenderer,
  unregisterHostRenderer,
  type HostRenderer,
} from "./host-renderer.js"
import type { HostRegistry } from "./registry.js"

type HostHttpServer = {
  port: number
  close(): Promise<void>
}

function rendererFromSocket(ws: WebSocket, clientId: string): HostRenderer {
  return {
    send(channel: string, ...args: unknown[]) {
      if (ws.readyState !== ws.OPEN) return
      ws.send(JSON.stringify({ channel, args }))
    },
    isDestroyed() {
      return ws.readyState !== ws.OPEN && ws.readyState !== ws.CONNECTING
    },
  }
}

export async function startHostHttpServer(registry: HostRegistry): Promise<HostHttpServer> {
  const sockets = new Map<string, WebSocket>()
  const defaultClientId = "default"

  const server = http.createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/rpc") {
      let body = ""
      req.on("data", chunk => {
        body += chunk
      })
      req.on("end", async () => {
        try {
          const parsed = JSON.parse(body) as { channel?: string; args?: unknown[]; clientId?: string }
          if (!parsed.channel) {
            res.writeHead(400, { "content-type": "application/json" })
            res.end(JSON.stringify({ ok: false, error: "missing channel" }))
            return
          }
          const clientId = parsed.clientId ?? defaultClientId
          const result = await registry.invoke(parsed.channel, parsed.args ?? [], clientId)
          res.writeHead(200, { "content-type": "application/json" })
          res.end(JSON.stringify({ ok: true, result }))
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          res.writeHead(500, { "content-type": "application/json" })
          res.end(JSON.stringify({ ok: false, error: message }))
        }
      })
      return
    }

    res.writeHead(404)
    res.end()
  })

  const wss = new WebSocketServer({ server, path: "/events" })
  wss.on("connection", ws => {
    sockets.set(defaultClientId, ws)
    registerHostRenderer(defaultClientId, rendererFromSocket(ws, defaultClientId))
    ws.on("close", () => {
      sockets.delete(defaultClientId)
      unregisterHostRenderer(defaultClientId)
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve())
    server.on("error", reject)
  })

  const address = server.address()
  if (!address || typeof address === "string") {
    throw new Error("failed to bind jet host http server")
  }

  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const ws of sockets.values()) ws.close()
        wss.close(err => {
          if (err) reject(err)
          else server.close(err2 => (err2 ? reject(err2) : resolve()))
        })
      }),
  }
}
