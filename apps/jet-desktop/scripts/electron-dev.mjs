#!/usr/bin/env node
/**
 * Dev entry: forwards `pnpm dev -- <path>` args to Electron only (not Vite).
 * Turbo appends args after `--` to the package script; Vite must not receive them.
 */
import { spawn } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.resolve(__dirname, "..")

const dash = process.argv.indexOf("--")
const launchArgs =
  dash >= 0
    ? process.argv.slice(dash + 1).filter(a => !a.startsWith("-"))
    : process.argv.slice(2).filter(a => !a.startsWith("-"))

process.env.JET_LAUNCH_ARGS = JSON.stringify(launchArgs)

const viteBin = path.join(packageDir, "node_modules", ".bin", "vite")
const child = spawn(viteBin, [], {
  stdio: "inherit",
  cwd: packageDir,
  env: process.env,
})

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
