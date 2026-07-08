import type { IpcMain, WebContents } from "electron"
import fs from "node:fs"
import os from "node:os"
import type { IPty } from "node-pty"
import { spawn as spawnPty } from "node-pty"
import { fileUriToPath } from "@jet/shared"

type TerminalEntry = { pty: IPty; webContents: WebContents }

const terminals = new Map<string, TerminalEntry>()

type ShellSpec = { file: string; args: string[] }

function primaryShell(): ShellSpec {
  if (process.platform === "win32") {
    return { file: process.env.COMSPEC || "powershell.exe", args: [] }
  }
  const file = process.env.SHELL || "/bin/zsh"
  if (file.endsWith("zsh") || file.endsWith("bash")) {
    return { file, args: ["-il"] }
  }
  return { file, args: [] }
}

function fallbackShells(primary: ShellSpec): ShellSpec[] {
  if (process.platform === "win32") return []
  const alt: ShellSpec[] = []
  if (primary.file !== "/bin/zsh") alt.push({ file: "/bin/zsh", args: ["-il"] })
  if (primary.file !== "/bin/bash") alt.push({ file: "/bin/bash", args: ["-il"] })
  alt.push({ file: "/bin/sh", args: [] })
  return alt
}

function shellTitleInit(shellFile: string): string | null {
  if (shellFile.endsWith("zsh")) {
    return [
      "precmd_jet_title() { printf '\\033]0;%s\\007' \"${PWD##*/}\"; }",
      "preexec_jet_title() { printf '\\033]0;%s\\007' \"$1\"; }",
      "precmd_functions+=(precmd_jet_title)",
      "preexec_functions+=(preexec_jet_title)",
      "precmd_jet_title",
      "",
    ].join("\n")
  }
  if (shellFile.endsWith("bash")) {
    return [
      "__jet_title_precmd() { printf '\\033]0;%s\\007' \"${PWD##*/}\"; }",
      "__jet_title_debug() { [ -n \"$COMP_LINE\" ] && return; [ \"$BASH_COMMAND\" = \"$PROMPT_COMMAND\" ] && return; printf '\\033]0;%s\\007' \"$BASH_COMMAND\"; }",
      "PROMPT_COMMAND=\"__jet_title_precmd;${PROMPT_COMMAND:-}\"",
      "trap '__jet_title_debug' DEBUG",
      "__jet_title_precmd",
      "",
    ].join("\n")
  }
  return null
}

function resolveCwd(cwdUri: string): string {
  let cwd = ""
  try {
    cwd = fileUriToPath(cwdUri)
  } catch {
    return os.homedir()
  }
  try {
    if (!fs.statSync(cwd).isDirectory()) return os.homedir()
  } catch {
    return os.homedir()
  }
  return cwd
}

export function registerTerminalHandlers(ipcMain: IpcMain) {
  ipcMain.handle("terminal:create", async (event, cwdUri: string) => {
    const id = `term-${Date.now()}`
    const primary = primaryShell()
    const cwd = resolveCwd(cwdUri)
    const env = {
      ...process.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      HOME: process.env.HOME || os.homedir(),
    } as Record<string, string>

    const attempts: ShellSpec[] = [primary, ...fallbackShells(primary)]
    let pty: IPty | null = null
    let usedShell: ShellSpec | null = null
    const errors: string[] = []
    for (const attempt of attempts) {
      try {
        pty = spawnPty(attempt.file, attempt.args, {
          name: "xterm-256color",
          cwd,
          env,
          cols: 80,
          rows: 24,
        })
        usedShell = attempt
        break
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        errors.push(`${attempt.file}: ${message}`)
      }
    }
    if (!pty || !usedShell) {
      throw new Error(`Failed to spawn shell in ${cwd}. Attempts: ${errors.join(" | ")}`)
    }

    const init = shellTitleInit(usedShell.file)
    if (init) pty.write(init)

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
