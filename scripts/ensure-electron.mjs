#!/usr/bin/env node
/**
 * pnpm rebuild electron does not re-run install.js when path.txt is missing.
 * Restore path.txt or download the Electron binary after install if needed.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const require = createRequire(import.meta.url)

const RESOLVE_SCOPES = [path.join(repoRoot, "apps/jet-desktop"), repoRoot]

function resolveElectronDir() {
  for (const scope of RESOLVE_SCOPES) {
    try {
      const pkgJson = require.resolve("electron/package.json", { paths: [scope] })
      return path.dirname(pkgJson)
    } catch {
      // electron not installed for this scope
    }
  }
  return null
}

function platformPath() {
  switch (process.env.npm_config_platform || os.platform()) {
    case "mas":
    case "darwin":
      return "Electron.app/Contents/MacOS/Electron"
    case "freebsd":
    case "openbsd":
    case "linux":
      return "electron"
    case "win32":
      return "electron.exe"
    default:
      throw new Error(`Electron builds are not available on platform: ${os.platform()}`)
  }
}

function isElectronInstalled(electronDir) {
  const { version } = require(path.join(electronDir, "package.json"))
  const distVersionPath = path.join(electronDir, "dist", "version")
  const pathTxt = path.join(electronDir, "path.txt")
  const platformRel = platformPath()
  const binaryPath = path.join(electronDir, "dist", platformRel)

  try {
    const distVersion = fs.readFileSync(distVersionPath, "utf-8").replace(/^v/, "")
    if (distVersion !== version) return false
    if (fs.existsSync(pathTxt) && fs.readFileSync(pathTxt, "utf-8") !== platformRel) return false
    return fs.existsSync(binaryPath)
  } catch {
    return false
  }
}

const electronDir = resolveElectronDir()
if (!electronDir) {
  process.exit(0)
}

const pathTxt = path.join(electronDir, "path.txt")
const platformRel = platformPath()

if (isElectronInstalled(electronDir)) {
  if (!fs.existsSync(pathTxt)) {
    fs.writeFileSync(pathTxt, platformRel)
    console.log("[ensure-electron] restored path.txt")
  }
  process.exit(0)
}

console.log("[ensure-electron] Electron binary missing — running electron/install.js")
const result = spawnSync(process.execPath, [path.join(electronDir, "install.js")], {
  stdio: "inherit",
  cwd: electronDir,
})

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}

if (!isElectronInstalled(electronDir)) {
  console.error("[ensure-electron] install.js finished but Electron binary is still missing")
  process.exit(1)
}
