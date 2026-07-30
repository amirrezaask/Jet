#!/usr/bin/env node
/**
 * Production build: Vite SPA → standalone server runtime → optional macOS DMG.
 *
 * Output:
 *   apps/gharargah/dist              SPA (intermediate)
 *   dist/gharargah/                  self-contained server (./gharargah to run)
 *   apps/gharargah-electron/pack     copy of dist/gharargah for electron-builder
 *   apps/gharargah-electron/dist/*.dmg (macOS only)
 */
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"
import { stageRuntimePack } from "./stage-electron-pack.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const electronDir = path.join(repoRoot, "apps/gharargah-electron")
const serverDir = path.join(repoRoot, "dist/gharargah")
const electronPackDir = path.join(electronDir, "pack")

function run(command, args, cwd = repoRoot, env = process.env) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env,
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function syncElectronPack(sourceDir) {
  fs.rmSync(electronPackDir, { recursive: true, force: true })
  fs.cpSync(sourceDir, electronPackDir, { recursive: true })
  console.log(`Electron pack synced → ${electronPackDir}`)
}

run("pnpm", ["--filter", "gharargah", "build"])
console.log("Frontend built to apps/gharargah/dist")

await stageRuntimePack(serverDir)
syncElectronPack(serverDir)

const serverLauncher = path.join(serverDir, "gharargah")
console.log(`Server binary: ${serverLauncher}`)
console.log(`  ${serverLauncher}              # serve SPA + API on http://127.0.0.1:4747`)
console.log(`  ${serverLauncher} /path/to/repo  # open workspace at path`)

if (process.platform !== "darwin") {
  console.warn(`Skipping macOS DMG on ${process.platform} (server runtime built).`)
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
