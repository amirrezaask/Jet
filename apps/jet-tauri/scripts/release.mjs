#!/usr/bin/env node
/**
 * Production macOS .app bundle (no e2e WebDriver plugin).
 * Output: src-tauri/target/release/bundle/macos/Jet-Tauri.app
 */
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const tauriDir = path.join(root, "src-tauri")
const productName = JSON.parse(fs.readFileSync(path.join(tauriDir, "tauri.conf.json"), "utf8")).productName ?? "Jet-Tauri"
const bundleApp = path.join(tauriDir, "target/release/bundle/macos", `${productName}.app`)

function run(cmd, args, cwd = root) {
  const result = spawnSync(cmd, args, { cwd, stdio: "inherit", env: process.env })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

run("node", ["scripts/cleanup-e2e-artifacts.mjs"])
run("pnpm", ["exec", "tauri", "build", "--bundles", "app"])

if (!fs.existsSync(bundleApp)) {
  console.error(`Bundle missing: ${bundleApp}`)
  process.exit(1)
}

console.log(`\n${productName}.app: ${bundleApp}`)
