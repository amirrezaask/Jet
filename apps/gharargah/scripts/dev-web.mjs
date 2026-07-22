#!/usr/bin/env node
import { spawn } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const repoRoot = path.resolve(appDir, "../..")
const children = [
  spawn("cargo", ["run", "--manifest-path", "apps/server/Cargo.toml", "--", "--port", "4747"], { cwd: repoRoot, stdio: "inherit" }),
  spawn(path.resolve(appDir, "node_modules/.bin/vite"), [], { cwd: appDir, stdio: "inherit", env: process.env }),
]

let stopping = false
function stop(signal = "SIGTERM") {
  if (stopping) return
  stopping = true
  for (const child of children) child.kill(signal)
}
process.on("SIGINT", () => stop("SIGINT"))
process.on("SIGTERM", () => stop("SIGTERM"))
for (const child of children) child.on("exit", code => { stop(); process.exitCode = code ?? 0 })
