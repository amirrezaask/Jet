import type { IpcMain, BrowserWindow } from "electron"
import type { IPty } from "node-pty"
import { spawn as spawnPty } from "node-pty"

const terminals = new Map<string, IPty>()

function uriToPath(uri: string): string {
  if (uri.startsWith("file://")) {
    const p = decodeURIComponent(uri.slice(7))
    return process.platform === "win32" && p.startsWith("/") ? p.slice(1) : p
  }
  return uri
}

export function registerTerminalHandlers(ipcMain: IpcMain, getWindow: () => BrowserWindow | null) {
  ipcMain.handle("terminal:create", async (_e, cwdUri: string) => {
    const id = `term-${Date.now()}`
    const shell = process.env.SHELL || (process.platform === "win32" ? "powershell.exe" : "/bin/bash")
    const cwd = uriToPath(cwdUri)
    const pty = spawnPty(shell, [], {
      name: "xterm-256color",
      cwd,
      env: process.env as Record<string, string>,
    })
    terminals.set(id, pty)
    pty.onData(data => {
      getWindow()?.webContents.send("terminal:data", id, data)
    })
    pty.onExit(() => {
      terminals.delete(id)
    })
    return { id }
  })

  ipcMain.handle("terminal:write", async (_e, id: string, data: string) => {
    terminals.get(id)?.write(data)
  })

  ipcMain.handle("terminal:resize", async (_e, id: string, cols: number, rows: number) => {
    terminals.get(id)?.resize(cols, rows)
  })

  ipcMain.handle("terminal:dispose", async (_e, id: string) => {
    const pty = terminals.get(id)
    if (pty) {
      pty.kill()
      terminals.delete(id)
    }
  })
}

export function stopAllTerminals() {
  for (const pty of terminals.values()) pty.kill()
  terminals.clear()
}
