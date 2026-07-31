/**
 * Enrich PATH for GUI-spawned agent-server processes (Tauri / DMG).
 * Mirrors login-shell PATH injection previously done in the desktop shell.
 */
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const SYSTEM_DIRS = new Set(["/usr/bin", "/bin", "/usr/sbin", "/sbin"])

function loginShellPath(): string | null {
  const shell = process.env.SHELL || "/bin/zsh"
  for (const args of [
    ["-ilc", "printenv PATH"],
    ["-lc", "printenv PATH"],
  ] as const) {
    try {
      const out = execFileSync(shell, args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5_000,
      }).trim()
      if (out) return out
    } catch {
      /* try next */
    }
  }
  return null
}

function isGuiStrippedPath(value: string): boolean {
  const dirs = value.split(":").filter(Boolean)
  if (dirs.length === 0) return true
  return dirs.every(d => SYSTEM_DIRS.has(d))
}

export function enrichProcessPath(): { path: string; enriched: boolean } {
  const current = process.env.PATH ?? ""
  // Escape hatch for callers that have already curated PATH and do not want a
  // login shell second-guessing it.
  if (process.env.GHARARGAH_SHELL_ENV_DISABLE === "1") {
    return { path: current, enriched: false }
  }
  if (!isGuiStrippedPath(current) && process.env.GHARARGAH_SHELL_ENV_FORCE !== "1") {
    return { path: current, enriched: false }
  }

  const dirs: string[] = []
  const push = (p: string) => {
    if (!p || dirs.includes(p)) return
    dirs.push(p)
  }

  const login = loginShellPath()
  if (login) {
    for (const d of login.split(":")) push(d)
  }

  const home = os.homedir()
  for (const rel of [".local/bin", ".cargo/bin", "bin", ".opencode/bin"]) {
    const candidate = path.join(home, rel)
    if (fs.existsSync(candidate)) push(candidate)
  }
  for (const system of [
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/local/sbin",
  ]) {
    if (fs.existsSync(system)) push(system)
  }
  for (const d of current.split(":")) push(d)

  const next =
    dirs.length > 0 ? dirs.join(":") : current || "/usr/bin:/bin:/usr/sbin:/sbin"
  process.env.PATH = next
  return { path: next, enriched: next !== current }
}

export type ShellEnvStatus = "ready" | "loading" | "error"

let status: ShellEnvStatus = "loading"

export function getShellEnvStatus(): ShellEnvStatus {
  return status
}

/** Call once at process boot before accepting WS clients. */
export function prepareShellEnv(): ShellEnvStatus {
  try {
    enrichProcessPath()
    status = "ready"
  } catch {
    status = "error"
  }
  return status
}
