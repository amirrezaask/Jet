import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { uriToPath } from "./paths.js"

function spawnDetached(program: string, args: string[]): void {
  const child = spawn(program, args, {
    detached: true,
    stdio: "ignore",
  })
  child.unref()
}

function tryCmds(attempts: string[][]): void {
  let lastErr = "no command succeeded"
  for (const attempt of attempts) {
    if (attempt.length === 0) continue
    const [cmd, ...args] = attempt
    if (!cmd) continue
    if (cmd === "open" && process.platform !== "darwin") continue
    if (
      (cmd === "code.cmd" || cmd === "subl.exe" || cmd === "cursor.cmd" || cmd === "zed.exe") &&
      process.platform !== "win32"
    ) {
      continue
    }
    try {
      spawnDetached(cmd, args)
      return
    } catch (error) {
      lastErr = String(error)
    }
  }
  throw new Error(lastErr)
}

function openMacosApp(appName: string, path: string): void {
  if (process.platform !== "darwin") throw new Error(`${appName} CLI not found`)
  spawnDetached("open", ["-a", appName, path])
}

export function openInApp(appId: string, rootUri: string): { ok: true } {
  const p = uriToPath(rootUri)
  if (!p) throw new Error("missing path")
  if (!fs.existsSync(p)) throw new Error(`path does not exist: ${p}`)

  switch (appId) {
    case "vscode":
      try {
        tryCmds([
          ["code", "-n", p],
          ["code.cmd", "-n", p],
        ])
      } catch {
        openMacosApp("Visual Studio Code", p)
      }
      break
    case "cursor":
      try {
        tryCmds([
          ["cursor", p],
          ["cursor.cmd", p],
        ])
      } catch {
        openMacosApp("Cursor", p)
      }
      break
    case "emacs":
      try {
        tryCmds([
          ["emacs", p],
          ["emacsclient", "-n", "-a", "", p],
        ])
      } catch {
        openMacosApp("Emacs", p)
      }
      break
    case "sublime":
      try {
        tryCmds([
          ["subl", p],
          ["subl.exe", p],
        ])
      } catch {
        openMacosApp("Sublime Text", p)
      }
      break
    case "zed":
      try {
        tryCmds([
          ["zed", p],
          ["zed.exe", p],
        ])
      } catch {
        openMacosApp("Zed", p)
      }
      break
    case "finder":
      if (process.platform === "darwin") spawnDetached("open", [p])
      else if (process.platform === "win32") spawnDetached("explorer", [p])
      else
        tryCmds([
          ["xdg-open", p],
          ["nautilus", p],
          ["dolphin", p],
        ])
      break
    case "terminal":
      if (process.platform === "darwin") openMacosApp("Terminal", p)
      else if (process.platform === "win32")
        spawnDetached("cmd", ["/c", "start", "cmd", "/k", "cd", "/d", p])
      else
        tryCmds([
          ["x-terminal-emulator", "--working-directory", p],
          ["gnome-terminal", "--working-directory", p],
          ["konsole", "--workdir", p],
        ])
      break
    case "kitty":
      try {
        tryCmds([
          ["kitty", "--directory", p],
          ["kitty", "--single-instance", "--directory", p],
        ])
      } catch {
        openMacosApp("kitty", p)
      }
      break
    case "ghostty": {
      const working = `--working-directory=${p}`
      try {
        tryCmds([
          ["ghostty", working],
          ["open", "-na", "Ghostty", "--args", working],
        ])
      } catch {
        openMacosApp("Ghostty", p)
      }
      break
    }
    case "xcode":
      try {
        tryCmds([["xed", p]])
      } catch {
        openMacosApp("Xcode", p)
      }
      break
    case "intellij":
      try {
        tryCmds([
          ["idea", p],
          ["idea64", p],
          ["intellij-idea-ultimate", p],
          ["intellij-idea-community", p],
        ])
      } catch {
        try {
          openMacosApp("IntelliJ IDEA", p)
        } catch {
          openMacosApp("IntelliJ IDEA CE", p)
        }
      }
      break
    default:
      throw new Error(`unknown app: ${appId}`)
  }
  return { ok: true }
}

/** Reveal a file or folder in the OS file manager (Finder / Explorer / xdg). */
export function revealInFolder(rootUri: string): { ok: true } {
  const p = uriToPath(rootUri)
  if (!p) throw new Error("missing path")
  if (!fs.existsSync(p)) throw new Error(`path does not exist: ${p}`)
  if (process.platform === "darwin") {
    spawnDetached("open", ["-R", p])
  } else if (process.platform === "win32") {
    spawnDetached("explorer", ["/select,", p])
  } else {
    const dir = fs.statSync(p).isDirectory() ? p : path.dirname(p)
    tryCmds([
      ["xdg-open", dir],
      ["nautilus", dir],
      ["dolphin", dir],
    ])
  }
  return { ok: true }
}
