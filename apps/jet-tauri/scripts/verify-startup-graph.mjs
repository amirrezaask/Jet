#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const dist = path.join(root, "dist")
const htmlPath = path.join(dist, "index.tauri.html")
const html = fs.readFileSync(htmlPath, "utf8")
const entryMatch = html.match(/<script[^>]+src="\.\/assets\/(index-[^"]+\.js)"/)
if (!entryMatch) throw new Error("Tauri entry chunk not found")

const entry = fs.readFileSync(path.join(dist, "assets", entryMatch[1]), "utf8")
const forbidden = ["shiki-", "diffs-", "xterm-"]
const violations = forbidden.filter(name => html.includes(name) || entry.includes(`from\"./${name}`))
if (violations.length > 0) {
  throw new Error(`optional chunks leaked into the startup graph: ${violations.join(", ")}`)
}

const preloads = [...html.matchAll(/rel="modulepreload"[^>]+href="([^"]+)"/g)].map(match => match[1])
console.log(JSON.stringify({ entry: entryMatch[1], preloads }, null, 2))
