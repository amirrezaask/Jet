#!/usr/bin/env node
import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const repoRoot = path.resolve(appDir, "../..")
const agentServerEntry = path.resolve(repoRoot, "apps/agent-server/src/bin.ts")
const hostServerEntry = path.resolve(repoRoot, "apps/host-server/src/bin.ts")

function resolveTsxCli() {
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

const tsxCli = resolveTsxCli()
const nodeBin = process.execPath

const children = [
  spawn(nodeBin, [tsxCli, hostServerEntry, "--port", "4747"], {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
    },
  }),
  spawn(nodeBin, [tsxCli, agentServerEntry], {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      GHARARGAH_AGENT_HOST: process.env.GHARARGAH_AGENT_HOST ?? "127.0.0.1",
      GHARARGAH_AGENT_PORT: process.env.GHARARGAH_AGENT_PORT ?? "4751",
      GHARARGAH_AGENT_RUNTIME: process.env.GHARARGAH_AGENT_RUNTIME ?? "effect",
    },
  }),
  spawn(path.resolve(appDir, "node_modules/.bin/vite"), [], {
    cwd: appDir,
    stdio: "inherit",
    env: {
      ...process.env,
      GHARARGAH_AGENT_RUNTIME: process.env.GHARARGAH_AGENT_RUNTIME ?? "effect",
    },
  }),
]

let stopping = false
function stop(signal = "SIGTERM") {
  if (stopping) return
  stopping = true
  for (const child of children) child.kill(signal)
}
process.on("SIGINT", () => stop("SIGINT"))
process.on("SIGTERM", () => stop("SIGTERM"))
for (const child of children)
  child.on("exit", code => {
    stop()
    process.exitCode = code ?? 0
  })
