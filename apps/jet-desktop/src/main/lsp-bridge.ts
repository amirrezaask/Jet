import type { IpcMain, BrowserWindow } from "electron"
import { spawn, type ChildProcess } from "node:child_process"
import { createServer, type Server as HttpServer } from "node:http"
import { WebSocketServer, type WebSocket } from "ws"

type LspSession = {
  id: string
  process: ChildProcess
  server: HttpServer
  wss: WebSocketServer
  port: number
  command: string
}

const sessions = new Map<string, LspSession>()
let crashCallback: ((id: string) => void) | null = null

function uriToPath(uri: string): string {
  if (uri.startsWith("file://")) {
    const p = decodeURIComponent(uri.slice(7))
    return process.platform === "win32" && p.startsWith("/") ? p.slice(1) : p
  }
  return uri
}

function bridgeStdioToWs(proc: ChildProcess, ws: WebSocket) {
  proc.stdout?.on("data", chunk => {
    if (ws.readyState === ws.OPEN) ws.send(chunk.toString())
  })
  ws.on("message", (data: WebSocket.RawData) => {
    proc.stdin?.write(typeof data === "string" ? data : Buffer.from(data as ArrayBuffer))
  })
  proc.on("exit", (code) => {
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

export function registerLspHandlers(ipcMain: IpcMain, getWindow: () => BrowserWindow | null) {
  ipcMain.handle(
    "lsp:start",
    async (
      _e,
      rootUri: string,
      _languageId: string,
      command?: string,
      args?: string[],
    ) => {
      const cmd = command ?? "typescript-language-server"
      const cmdArgs = args ?? ["--stdio"]
      const id = `lsp-${cmd}-${Date.now()}`
      const cwd = uriToPath(rootUri)

      const proc = spawn(cmd, cmdArgs, {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env,
      })

      proc.on("error", err => {
        console.error("LSP spawn error:", err)
        crashCallback?.(id)
        getWindow()?.webContents.send("lsp:crashed", id)
      })

      const server = createServer()
      const wss = new WebSocketServer({ server })

      await new Promise<void>((resolve, reject) => {
        server.listen(0, "127.0.0.1", () => resolve())
        server.on("error", reject)
      })

      const addr = server.address()
      const port = typeof addr === "object" && addr ? addr.port : 0

      wss.on("connection", (ws: WebSocket) => {
        bridgeStdioToWs(proc, ws)
      })

      const session: LspSession = { id, process: proc, server, wss, port, command: cmd }
      sessions.set(id, session)

      return { id, transportUrl: `ws://127.0.0.1:${port}` }
    },
  )

  ipcMain.handle("lsp:stop", async (_e, id: string) => {
    const session = sessions.get(id)
    if (session) {
      session.process.kill()
      session.wss.close()
      session.server.close()
      sessions.delete(id)
    }
  })

  ipcMain.on("lsp:registerCrashListener", () => {
    /* handshake — renderer uses onCrashed via preload */
  })
}

export function setLspCrashHandler(cb: (id: string) => void) {
  crashCallback = cb
}

export function stopAllLsp() {
  for (const session of sessions.values()) {
    session.process.kill()
    session.wss.close()
    session.server.close()
  }
  sessions.clear()
}
