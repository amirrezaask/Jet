import { spawn, type ChildProcess } from "node:child_process"
import { createServer, type Server as HttpServer } from "node:http"
import { WebSocketServer, type WebSocket } from "ws"
import { uriToPath } from "./paths.js"

export type LspSession = {
  id: string
  process: ChildProcess
  server: HttpServer
  wss: WebSocketServer
  port: number
  command: string
}

const sessions = new Map<string, LspSession>()
let crashCallback: ((id: string) => void) | null = null

/** Decode LSP stdio Content-Length framing into raw JSON strings. */
export class LspFramingDecoder {
  private buffer: Buffer = Buffer.alloc(0)

  feed(chunk: Buffer): string[] {
    this.buffer = Buffer.concat([this.buffer, chunk])
    const messages: string[] = []
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n")
      if (headerEnd < 0) break
      const header = this.buffer.subarray(0, headerEnd).toString("latin1")
      const match = /Content-Length:\s*(\d+)/i.exec(header)
      if (!match) {
        this.buffer = this.buffer.subarray(headerEnd + 4)
        continue
      }
      const length = Number.parseInt(match[1]!, 10)
      const bodyStart = headerEnd + 4
      if (this.buffer.length < bodyStart + length) break
      messages.push(this.buffer.subarray(bodyStart, bodyStart + length).toString("utf8"))
      this.buffer = this.buffer.subarray(bodyStart + length)
    }
    return messages
  }
}

/** Encode raw JSON string to LSP stdio Content-Length framing. */
export function encodeLspMessage(json: string): string {
  const bytes = Buffer.byteLength(json, "utf8")
  return `Content-Length: ${bytes}\r\n\r\n${json}`
}

function bridgeStdioToWs(proc: ChildProcess, ws: WebSocket) {
  const decoder = new LspFramingDecoder()

  proc.stdout?.on("data", chunk => {
    if (ws.readyState !== ws.OPEN) return
    for (const msg of decoder.feed(chunk)) {
      ws.send(msg)
    }
  })

  ws.on("message", (data: WebSocket.RawData) => {
    const json = typeof data === "string" ? data : Buffer.from(data as ArrayBuffer).toString("utf8")
    proc.stdin?.write(encodeLspMessage(json))
  })

  proc.on("exit", code => {
    ws.close()
    if (code && code !== 0) {
      for (const [id, session] of sessions) {
        if (session.process === proc) {
          crashCallback?.(id)
          break
        }
      }
    }
  })

  ws.on("close", () => proc.kill())
}

export type StartLspSessionOptions = {
  rootUri: string
  command?: string
  args?: string[]
  onSpawnError?: (id: string) => void
}

export async function startLspSession(opts: StartLspSessionOptions): Promise<{ id: string; transportUrl: string }> {
  const cmd = opts.command ?? "typescript-language-server"
  const cmdArgs = opts.args ?? ["--stdio"]
  const id = `lsp-${cmd}-${Date.now()}`
  const cwd = uriToPath(opts.rootUri)

  const proc = spawn(cmd, cmdArgs, {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  })

  proc.on("error", err => {
    console.error("LSP spawn error:", err)
    crashCallback?.(id)
    opts.onSpawnError?.(id)
  })

  const server = createServer()
  const wss = new WebSocketServer({ server })
  let activeWs: WebSocket | null = null

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve())
    server.on("error", reject)
  })

  const addr = server.address()
  const port = typeof addr === "object" && addr ? addr.port : 0

  wss.on("connection", (ws: WebSocket) => {
    if (activeWs) {
      activeWs.close()
    }
    activeWs = ws
    bridgeStdioToWs(proc, ws)
  })

  const session: LspSession = { id, process: proc, server, wss, port, command: cmd }
  sessions.set(id, session)

  return { id, transportUrl: `ws://127.0.0.1:${port}` }
}

export async function stopLspSession(id: string): Promise<void> {
  const session = sessions.get(id)
  if (!session) return
  session.process.kill()
  session.wss.close()
  session.server.close()
  sessions.delete(id)
}

export function stopAllLspSessions(): void {
  for (const session of sessions.values()) {
    session.process.kill()
    session.wss.close()
    session.server.close()
  }
  sessions.clear()
}

export function setLspCrashHandler(cb: (id: string) => void): void {
  crashCallback = cb
}

export function getLspSession(id: string): LspSession | undefined {
  return sessions.get(id)
}
