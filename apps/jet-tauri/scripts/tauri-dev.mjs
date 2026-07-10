#!/usr/bin/env node
import { spawn, execSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "../../..")
const sidecarEntry = path.resolve(repoRoot, "packages/jet-host/dist/sidecar.js")
const devPort = process.env.JET_TAURI_DEV_PORT ?? "5174"

function freePort(port) {
  try {
    const pids = execSync(`lsof -ti :${port}`, { encoding: "utf8" }).trim()
    if (!pids) return
    for (const pid of pids.split(/\s+/)) {
      if (pid) process.kill(Number(pid), "SIGKILL")
    }
  } catch {
    /* port free */
  }
}

function forwardLaunchArgs() {
  const dash = process.argv.indexOf("--")
  const launchArgs =
    dash >= 0
      ? process.argv.slice(dash + 1).filter(a => !a.startsWith("-"))
      : process.argv.slice(2).filter(a => !a.startsWith("-"))
  return launchArgs
}

async function waitForPort(child, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("jet-host sidecar did not become ready")), timeoutMs)
    child.stdout?.on("data", chunk => {
      const text = chunk.toString()
      process.stdout.write(text)
      const match = text.match(/JET_HOST_READY port=(\d+)/)
      if (match) {
        clearTimeout(timer)
        resolve(Number(match[1]))
      }
    })
    child.on("exit", code => {
      clearTimeout(timer)
      reject(new Error(`jet-host sidecar exited (${code ?? "unknown"})`))
    })
    child.on("error", err => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

function pkillStaleSidecars() {
  try {
    execSync("pkill -f 'jet-host/dist/sidecar.js'", { stdio: "ignore" })
  } catch {
    /* none running */
  }
}

const launchArgs = forwardLaunchArgs()
freePort(devPort)
pkillStaleSidecars()

const sidecar = spawn(process.execPath, [sidecarEntry, "--", ...launchArgs], {
  cwd: repoRoot,
  env: { ...process.env },
  stdio: ["ignore", "pipe", "inherit"],
})

const port = await waitForPort(sidecar)
process.env.VITE_JET_HOST_URL = `http://127.0.0.1:${port}`
process.env.JET_TAURI_DEV_PORT = devPort

const shutdown = () => {
  sidecar.kill("SIGTERM")
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
sidecar.on("exit", code => {
  if (code && code !== 0) process.exit(code)
})

const tauriBin = path.resolve(__dirname, "../node_modules/.bin/tauri")
const child = spawn(tauriBin, ["dev"], {
  stdio: "inherit",
  cwd: path.resolve(__dirname, ".."),
  env: process.env,
})

child.on("exit", (code, signal) => {
  shutdown()
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
