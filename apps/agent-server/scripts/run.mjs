#!/usr/bin/env node
/**
 * Launcher for Tauri / packaged desktop: resolves tsx CLI and starts agent-server
 * using the SAME node that launched this script (avoids ABI mismatches).
 *
 * Env: GHARARGAH_AGENT_HOST, GHARARGAH_AGENT_PORT (default 4751).
 */
import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const agentRoot = path.resolve(here, "..")
const repoRoot = path.resolve(agentRoot, "../..")
const entry = path.join(agentRoot, "src/bin.ts")

const tsxCliCandidates = [
  process.env.GHARARGAH_TSX_CLI,
  path.join(repoRoot, "node_modules/tsx/dist/cli.mjs"),
  path.join(repoRoot, "node_modules/.pnpm/tsx@4.23.0/node_modules/tsx/dist/cli.mjs"),
]

let tsxCli = null
for (const c of tsxCliCandidates) {
  if (c && fs.existsSync(c)) {
    tsxCli = c
    break
  }
}

// pnpm may nest tsx under a versioned path — glob fallback
if (!tsxCli) {
  const pnpmDir = path.join(repoRoot, "node_modules/.pnpm")
  if (fs.existsSync(pnpmDir)) {
    for (const name of fs.readdirSync(pnpmDir)) {
      if (!name.startsWith("tsx@")) continue
      const candidate = path.join(pnpmDir, name, "node_modules/tsx/dist/cli.mjs")
      if (fs.existsSync(candidate)) {
        tsxCli = candidate
        break
      }
    }
  }
}

if (!tsxCli) {
  console.error("[gharargah-agent-server] tsx CLI not found; run pnpm install")
  process.exit(1)
}
if (!fs.existsSync(entry)) {
  console.error(`[gharargah-agent-server] entry missing: ${entry}`)
  process.exit(1)
}

// Use the same node that launched this script so better-sqlite3 ABI matches.
const child = spawn(process.execPath, [tsxCli, entry], {
  cwd: repoRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    GHARARGAH_AGENT_HOST: process.env.GHARARGAH_AGENT_HOST ?? "127.0.0.1",
    GHARARGAH_AGENT_PORT: process.env.GHARARGAH_AGENT_PORT ?? "4751",
    GHARARGAH_AGENT_RUNTIME: process.env.GHARARGAH_AGENT_RUNTIME ?? "effect",
  },
})

child.on("exit", code => process.exit(code ?? 1))
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal))
}
