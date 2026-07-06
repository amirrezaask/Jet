#!/usr/bin/env node
/**
 * pnpm can install node-pty prebuilds without the executable bit on spawn-helper.
 * macOS posix_spawn then fails with "posix_spawnp failed." — restore +x after install.
 */
import { createRequire } from "node:module"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const require = createRequire(import.meta.url)

const EXEC_NAMES = new Set(["spawn-helper", "winpty-agent.exe"])

function chmodExecutable(filePath) {
  try {
    const mode = fs.statSync(filePath).mode
    if ((mode & 0o111) === 0) {
      fs.chmodSync(filePath, mode | 0o755)
      console.log(`[fix-node-pty-perms] +x ${filePath}`)
    }
  } catch {
    // missing or unreadable — skip
  }
}

function fixPackageRoot(pkgRoot) {
  for (const sub of ["prebuilds", path.join("build", "Release"), path.join("build", "Debug")]) {
    const base = path.join(pkgRoot, sub)
    if (!fs.existsSync(base)) continue
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      const full = path.join(base, entry.name)
      if (entry.isDirectory()) {
        for (const name of EXEC_NAMES) {
          chmodExecutable(path.join(full, name))
        }
      } else if (EXEC_NAMES.has(entry.name)) {
        chmodExecutable(full)
      }
    }
  }
}

const roots = new Set()
for (const scope of [repoRoot, path.join(repoRoot, "apps/jet-desktop")]) {
  try {
    const pkgJson = require.resolve("node-pty/package.json", { paths: [scope] })
    roots.add(path.dirname(pkgJson))
  } catch {
    // node-pty not installed for this scope
  }
}

for (const root of roots) {
  fixPackageRoot(root)
}
