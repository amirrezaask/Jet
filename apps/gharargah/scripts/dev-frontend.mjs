#!/usr/bin/env node
import { spawn } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const viteBin = path.resolve(__dirname, "../node_modules/.bin/vite")
const vite = spawn(viteBin, [], {
  stdio: "inherit",
  cwd: path.resolve(__dirname, ".."),
  env: process.env,
})

vite.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
