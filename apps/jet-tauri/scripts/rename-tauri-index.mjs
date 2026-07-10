#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist")
const from = path.join(dist, "index.tauri.html")
const to = path.join(dist, "index.html")
if (!fs.existsSync(from)) {
  console.error("[jet-tauri] missing build output:", from)
  process.exit(1)
}
fs.copyFileSync(from, to)
