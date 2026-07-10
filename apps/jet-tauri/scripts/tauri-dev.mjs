#!/usr/bin/env node
import { spawn } from "node:child_process"
import net from "node:net"
import path from "node:path"
import { fileURLToPath } from "node:url"

import "./cleanup-e2e-artifacts.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const devPort = Number(process.env.JET_TAURI_DEV_PORT ?? 5174)

function forwardLaunchArgs() {
  const dash = process.argv.indexOf("--")
  const launchArgs =
    dash >= 0
      ? process.argv.slice(dash + 1).filter(a => !a.startsWith("-"))
      : process.argv.slice(2).filter(a => !a.startsWith("-"))
  return launchArgs
}

async function isPortFree(port) {
  return new Promise(resolve => {
    const server = net.createServer()
    server.once("error", () => resolve(false))
    server.once("listening", () => {
      server.close(() => resolve(true))
    })
    server.listen(port, "127.0.0.1")
  })
}

async function waitForPortFree(port, timeoutMs = 5_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await isPortFree(port)) return
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error(`port ${port} still in use after ${timeoutMs}ms`)
}

const launchArgs = forwardLaunchArgs()
if (launchArgs.length > 0) {
  process.env.JET_LAUNCH_ARGS = JSON.stringify(launchArgs)
}

await waitForPortFree(devPort)
process.env.JET_TAURI_DEV_PORT = String(devPort)

const tauriBin = path.resolve(__dirname, "../node_modules/.bin/tauri")
const tauriArgs = ["dev"]
if (launchArgs.length > 0) {
  tauriArgs.push("--", ...launchArgs)
}

const child = spawn(tauriBin, tauriArgs, {
  stdio: "inherit",
  cwd: path.resolve(__dirname, ".."),
  env: process.env,
})

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
