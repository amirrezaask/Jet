import { execFileSync, execSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const SYSTEM_DIRS = new Set(["/usr/bin", "/bin", "/usr/sbin", "/sbin"])

function shellBasename(shell: string): string {
  return path.basename(shell)
}

function loginShellPath(): string | null {
  if (process.platform === "win32") return null
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

/** @deprecated Prefer {@link enrichProcessPath} — kept for callers that only need PATH. */
export function resolveLoginShellPath(): string | undefined {
  if (process.platform === "win32") return undefined
  const shell = process.env.SHELL || "/bin/bash"
  const base = shellBasename(shell)
  try {
    const cmd =
      base === "fish"
        ? `${shell} -l -c 'printf "%s" $PATH'`
        : `${shell} -l -ilc 'printf "%s" "$PATH"'`
    const stdout = execSync(cmd, {
      encoding: "utf8",
      timeout: 5000,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    })
    const trimmed = stdout.trim()
    return trimmed || undefined
  } catch (err) {
    console.warn("[jet] failed to resolve login shell PATH:", err)
    return undefined
  }
}

/**
 * Enrich PATH for GUI-spawned host processes (Electron / DMG) so PTY shells and
 * agent CLIs resolve the same binaries as a login terminal.
 */
export function enrichProcessPath(): { path: string; enriched: boolean } {
  const current = process.env.PATH ?? ""
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

/** Call once at host boot before accepting RPC clients. */
export function applyLoginShellEnv(): void {
  enrichProcessPath()
}
