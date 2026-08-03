#!/usr/bin/env node
/**
 * Production build: Vite SPA → runtime pack → self-extracting server → macOS DMG.
 *
 * Output:
 *   apps/yaade/dist                 SPA (intermediate)
 *   dist/runtime/                       unpacked runtime (Electron + SEF source)
 *   dist/yaade                          self-extracting server binary
 *   dist/YAADE-*.dmg                    desktop installer (macOS only)
 *
 * Flags:
 *   --server-only   skip DMG
 *   --dmg-only      skip Vite/SEF; require existing dist/runtime; build DMG only
 */
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"
import { packSelfExtracting } from "./pack-sef.mjs"
import { stageRuntimePack } from "./stage-runtime-pack.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const electronDir = path.join(repoRoot, "apps/yaade-electron")
const runtimeDir = path.join(repoRoot, "dist/runtime")
const sefOut = path.join(repoRoot, "dist/yaade")
const distDir = path.join(repoRoot, "dist")
const electronPackDir = path.join(electronDir, "pack")
const electronDistDir = path.join(electronDir, "dist")

const args = new Set(process.argv.slice(2))
const serverOnly = args.has("--server-only")
const dmgOnly = args.has("--dmg-only")
if (serverOnly && dmgOnly) {
  console.error("Use either --server-only or --dmg-only, not both")
  process.exit(1)
}

function run(command, argsList, cwd = repoRoot, env = process.env) {
  const result = spawnSync(command, argsList, {
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

function promoteDmgs() {
  if (!fs.existsSync(electronDistDir)) {
    console.error("electron-builder finished but dist dir missing:", electronDistDir)
    process.exit(1)
  }
  const dmgs = fs
    .readdirSync(electronDistDir)
    .filter(name => name.startsWith("YAADE-") && name.endsWith(".dmg"))
  if (dmgs.length === 0) {
    console.error("electron-builder finished but no YAADE-*.dmg found in", electronDistDir)
    process.exit(1)
  }
  fs.mkdirSync(distDir, { recursive: true })
  for (const name of dmgs) {
    const src = path.join(electronDistDir, name)
    const dest = path.join(distDir, name)
    fs.copyFileSync(src, dest)
    console.log(`DMG: ${dest}`)
  }
}

function buildDmg() {
  if (process.platform !== "darwin") {
    console.warn(`Skipping macOS DMG on ${process.platform}`)
    return
  }
  if (!fs.existsSync(path.join(runtimeDir, "yaade"))) {
    console.error(`Runtime missing at ${runtimeDir}; run a full build first`)
    process.exit(1)
  }
  syncElectronPack(runtimeDir)
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
  promoteDmgs()
}

if (dmgOnly) {
  buildDmg()
  process.exit(0)
}

run("pnpm", ["--filter", "yaade", "build"])
console.log("Frontend built to apps/yaade/dist")

await stageRuntimePack(runtimeDir)
// Replace legacy directory artifact (old builds wrote dist/yaade/ as a pack).
fs.rmSync(sefOut, { recursive: true, force: true })
packSelfExtracting(runtimeDir, sefOut)

console.log(`Server binary: ${sefOut}`)
console.log(`  ${sefOut}              # serve SPA + API on http://127.0.0.1:4747`)
console.log(`  ${sefOut} /path/to/repo  # open workspace at path`)
console.log(`  ${sefOut} --open         # also open the default browser`)

if (serverOnly) {
  process.exit(0)
}

if (process.platform !== "darwin") {
  console.warn(`Skipping macOS DMG on ${process.platform} (server binary built).`)
  process.exit(0)
}

buildDmg()
