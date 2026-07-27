#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

function run(command, args, cwd = repoRoot) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run("pnpm", ["--filter", "gharargah", "build"])
console.log("Frontend built to apps/gharargah/dist")
console.log("Run host: pnpm --filter @gharargah/host-server start")
