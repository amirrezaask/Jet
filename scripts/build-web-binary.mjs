#!/usr/bin/env node
/**
 * Production build: Vite SPA → stage Electron runtime → macOS DMG.
 *
 * Output:
 *   apps/gharargah/dist              SPA
 *   apps/gharargah-electron/pack     bundled backends + Node + web
 *   apps/gharargah-electron/dist/*.dmg
 */
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const electronDir = path.join(repoRoot, "apps/gharargah-electron")

function run(command, args, cwd = repoRoot, env = process.env) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env,
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run("pnpm", ["--filter", "gharargah", "build"])
console.log("Frontend built to apps/gharargah/dist")

run("node", [path.join(repoRoot, "scripts/stage-electron-pack.mjs")])

if (process.platform !== "darwin") {
  console.warn(`Skipping macOS DMG on ${process.platform} (pack staged only).`)
  console.log(`Pack: ${path.join(electronDir, "pack")}`)
  process.exit(0)
}

run(
  "pnpm",
  ["exec", "electron-builder", "--mac", "dmg", "--publish", "never"],
  electronDir,
  {
    ...process.env,
    // Local/unsigned builds — avoid hanging on keychain identity discovery.
    CSC_IDENTITY_AUTO_DISCOVERY: process.env.CSC_IDENTITY_AUTO_DISCOVERY ?? "false",
  },
)

const distDir = path.join(electronDir, "dist")
const dmgs = fs.existsSync(distDir)
  ? fs.readdirSync(distDir).filter(name => name.endsWith(".dmg"))
  : []
if (dmgs.length === 0) {
  console.error("electron-builder finished but no .dmg found in", distDir)
  process.exit(1)
}
for (const name of dmgs) {
  console.log(`DMG: ${path.join(distDir, name)}`)
}
