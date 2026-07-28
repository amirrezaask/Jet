#!/usr/bin/env node
/**
 * Shared host / agent / Vite spawn helpers for web dev and Electron.
 * Host/agent always run under system Node (never Electron's Node) so node-pty stays ABI-safe.
 */
import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const DEFAULT_HOST = "127.0.0.1"
export const DEFAULT_HOST_PORT = 4747
export const DEFAULT_AGENT_PORT = 4751
export const DEFAULT_VITE_PORT = 5174

export function resolveAppDir(fromMetaUrl = import.meta.url) {
  return path.resolve(path.dirname(fileURLToPath(fromMetaUrl)), "..")
}

export function resolveRepoRoot(appDir) {
  return path.resolve(appDir, "../..")
}

export function resolveTsxCli(repoRoot) {
  const candidates = [
    process.env.GHARARGAH_TSX_CLI,
    path.join(repoRoot, "node_modules/tsx/dist/cli.mjs"),
  ]
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c
  }
  const pnpmDir = path.join(repoRoot, "node_modules/.pnpm")
  if (fs.existsSync(pnpmDir)) {
    for (const name of fs.readdirSync(pnpmDir)) {
      if (!name.startsWith("tsx@")) continue
      const candidate = path.join(pnpmDir, name, "node_modules/tsx/dist/cli.mjs")
      if (fs.existsSync(candidate)) return candidate
    }
  }
  throw new Error("tsx CLI not found; run pnpm install")
}

/** Prefer real Node when running inside Electron (process.execPath is Electron). */
export function resolveNodeBin() {
  if (process.versions.electron) {
    const fromNpm = process.env.npm_node_execpath
    if (fromNpm && fs.existsSync(fromNpm)) return fromNpm
    return "node"
  }
  return process.execPath
}

export function resolveViteBin(appDir) {
  return path.resolve(appDir, "node_modules/.bin/vite")
}

/**
 * @param {{
 *   repoRoot: string
 *   port?: number
 *   host?: string
 *   launchPath?: string
 *   extraArgs?: string[]
 *   stdio?: import('node:child_process').StdioOptions
 *   env?: NodeJS.ProcessEnv
 * }} opts
 */
export function spawnHostServer(opts) {
  const {
    repoRoot,
    port = Number(process.env.JET_PORT ?? DEFAULT_HOST_PORT),
    host = process.env.JET_HOST ?? DEFAULT_HOST,
    launchPath,
    extraArgs = [],
    stdio = "inherit",
    env = process.env,
  } = opts
  const tsxCli = resolveTsxCli(repoRoot)
  const nodeBin = resolveNodeBin()
  const entry = path.resolve(repoRoot, "apps/host-server/src/bin.ts")
  const args = [tsxCli, entry, "--host", host, "--port", String(port), ...extraArgs]
  if (launchPath) args.push(launchPath)
  return spawn(nodeBin, args, {
    cwd: repoRoot,
    stdio,
    env: { ...env },
  })
}

/**
 * @param {{
 *   repoRoot: string
 *   stdio?: import('node:child_process').StdioOptions
 *   env?: NodeJS.ProcessEnv
 * }} opts
 */
export function spawnAgentServer(opts) {
  const { repoRoot, stdio = "inherit", env = process.env } = opts
  const tsxCli = resolveTsxCli(repoRoot)
  const nodeBin = resolveNodeBin()
  const entry = path.resolve(repoRoot, "apps/agent-server/src/bin.ts")
  return spawn(nodeBin, [tsxCli, entry], {
    cwd: repoRoot,
    stdio,
    env: {
      ...env,
      GHARARGAH_AGENT_HOST: env.GHARARGAH_AGENT_HOST ?? DEFAULT_HOST,
      GHARARGAH_AGENT_PORT: env.GHARARGAH_AGENT_PORT ?? String(DEFAULT_AGENT_PORT),
      GHARARGAH_AGENT_RUNTIME: env.GHARARGAH_AGENT_RUNTIME ?? "effect",
    },
  })
}

/**
 * @param {{
 *   appDir: string
 *   stdio?: import('node:child_process').StdioOptions
 *   env?: NodeJS.ProcessEnv
 * }} opts
 */
export function spawnVite(opts) {
  const { appDir, stdio = "inherit", env = process.env } = opts
  return spawn(resolveViteBin(appDir), [], {
    cwd: appDir,
    stdio,
    env: {
      ...env,
      GHARARGAH_AGENT_RUNTIME: env.GHARARGAH_AGENT_RUNTIME ?? "effect",
    },
  })
}

/**
 * Kill all children on SIGINT/SIGTERM; if any child exits, stop the rest and set exitCode.
 * @param {import('node:child_process').ChildProcess[]} children
 * @param {{ exitProcess?: boolean }} [opts]
 */
export function wireChildLifecycle(children, opts = {}) {
  const { exitProcess = true } = opts
  let stopping = false
  function stop(signal = "SIGTERM") {
    if (stopping) return
    stopping = true
    for (const child of children) {
      try {
        child.kill(signal)
      } catch {
        /* ignore */
      }
    }
  }
  process.on("SIGINT", () => stop("SIGINT"))
  process.on("SIGTERM", () => stop("SIGTERM"))
  for (const child of children) {
    child.on("exit", code => {
      stop()
      if (exitProcess) process.exitCode = code ?? 0
    })
  }
  return { stop }
}

/**
 * @param {string} url
 * @param {{ timeoutMs?: number; intervalMs?: number }} [opts]
 */
export async function waitForUrl(url, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 60_000
  const intervalMs = opts.intervalMs ?? 200
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok || res.status === 404) return
      lastError = new Error(`HTTP ${res.status}`)
    } catch (err) {
      lastError = err
    }
    await new Promise(r => setTimeout(r, intervalMs))
  }
  throw new Error(`Timed out waiting for ${url}${lastError ? `: ${lastError}` : ""}`)
}
