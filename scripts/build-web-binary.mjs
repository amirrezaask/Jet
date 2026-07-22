#!/usr/bin/env node
import { spawnSync } from "node:child_process"

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", env: process.env })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run("pnpm", ["--filter", "gharargah", "build"])
run("cargo", ["build", "--release", "--manifest-path", "apps/server/Cargo.toml"])
console.log("Jet executable: apps/server/target/release/jet")
