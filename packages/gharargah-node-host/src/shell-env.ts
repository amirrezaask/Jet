import { execSync } from "node:child_process"
import path from "node:path"

function shellBasename(shell: string): string {
  return path.basename(shell)
}

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

export function applyLoginShellEnv(): void {
  const pathEnv = resolveLoginShellPath()
  if (pathEnv) process.env.PATH = pathEnv
}
