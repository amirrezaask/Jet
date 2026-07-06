import type { IpcMain, WebContents } from "electron"
import fs from "node:fs"
import os from "node:os"
import type { IPty } from "node-pty"
import { spawn as spawnPty } from "node-pty"
import { fileUriToPath } from "@jet/shared"

type TerminalEntry = { pty: IPty; webContents: WebContents }

const terminals = new Map<string, TerminalEntry>()

function resolveShell(): { file: string; args: string[] } {
  if (process.platform === "win32") {
    return { file: process.env.COMSPEC || "powershell.exe", args: [] }
  }
  const file = process.env.SHELL || "/bin/zsh"
  if (file.endsWith("zsh") || file.endsWith("bash")) {
    return { file, args: ["-il"] }
  }
  return { file, args: [] }
}

function resolveCwd(cwdUri: string): string {
  let cwd = fileUriToPath(cwdUri)
  try {
    if (!fs.statSync(cwd).isDirectory()) {
      cwd = os.homedir()
    }
  } catch {
    cwd = os.homedir()
  }
  return cwd
}

export function registerTerminalHandlers(ipcMain: IpcMain) {
  ipcMain.handle("terminal:create", async (event, cwdUri: string) => {
    const id = `term-${Date.now()}`
    const { file, args } = resolveShell()
    const cwd = resolveCwd(cwdUri)
    const env = {
      ...process.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
    } as Record<string, string>

    let pty: IPty
    try {
      pty = spawnPty(file, args, {
        name: "xterm-256color",
        cwd,
        env,
        cols: 80,
        rows: 24,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`Failed to spawn ${file} in ${cwd}: ${message}`)
    }

    const webContents = event.sender
    terminals.set(id, { pty, webContents })
    pty.onData(data => {
      terminals.get(id)?.webContents.send("terminal:data", id, data)
    })
    pty.onExit(() => {
      terminals.delete(id)
    })
    return { id }
  })

  ipcMain.handle("terminal:write", async (_e, id: string, data: string) => {
    terminals.get(id)?.pty.write(data)
  })

  ipcMain.handle("terminal:resize", async (_e, id: string, cols: number, rows: number) => {
    const entry = terminals.get(id)
    if (!entry) return
    if (cols > 0 && rows > 0) entry.pty.resize(cols, rows)
  })

  ipcMain.handle("terminal:dispose", async (_e, id: string) => {
    const entry = terminals.get(id)
    if (entry) {
      entry.pty.kill()
      terminals.delete(id)
    }
  })
}

export function stopAllTerminals() {
  for (const { pty } of terminals.values()) pty.kill()
  terminals.clear()
}
