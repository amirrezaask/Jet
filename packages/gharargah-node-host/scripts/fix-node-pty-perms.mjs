#!/usr/bin/env node
/** Fix node-pty macOS spawn-helper missing +x (pnpm + node-pty@1.1.0 packaging bug). */
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"

try {
  const require = createRequire(import.meta.url)
  const ptyRoot = path.dirname(require.resolve("node-pty/package.json"))
  const prebuilds = path.join(ptyRoot, "prebuilds")
  if (!fs.existsSync(prebuilds)) process.exit(0)
  for (const platform of fs.readdirSync(prebuilds)) {
    const helper = path.join(prebuilds, platform, "spawn-helper")
    if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755)
  }
} catch {
  /* optional */
}
