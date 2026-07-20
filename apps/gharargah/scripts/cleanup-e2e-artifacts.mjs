#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const tauriDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src-tauri")
const confPath = path.join(tauriDir, "tauri.conf.json")
const e2eCapPath = path.join(tauriDir, "capabilities/e2e.json")

if (fs.existsSync(e2eCapPath)) {
  fs.unlinkSync(e2eCapPath)
}

const conf = JSON.parse(fs.readFileSync(confPath, "utf8"))
const caps = conf.app.security.capabilities
const next = caps.filter(id => id !== "e2e")
if (next.length !== caps.length) {
  conf.app.security.capabilities = next
  fs.writeFileSync(confPath, `${JSON.stringify(conf, null, 2)}\n`)
}
