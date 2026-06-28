#!/usr/bin/env node
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(fileURLToPath(import.meta.url), "..", "..")
const DEFAULTS_FILE = join(ROOT, "packages/jet-workspace/src/default-keybindings.ts")
const MAP_FILE = join(ROOT, "packages/jet-workspace/data/jet-vscode-command-map.json")

const JET_COMMAND_KEY = {
  "workspace.quickOpen": "quickOpen",
  "ui.showCommandPalette": "palette",
  "workspace.saveFile": "save",
  "workspace.openFile": "openFile",
  "workspace.openFolder": "openFolder",
  "layout.closeTab": "closeTab",
  "editor.find": "find",
  "editor.replace": "replace",
  "editor.gotoLine": "gotoLine",
  "search.show": "search",
  "git.showChanges": "git",
  "explorer.show": "explorer",
  "terminal.show": "terminal",
  "problems.show": "problems",
}

async function main() {
  const src = await readFile(DEFAULTS_FILE, "utf8")
  const map = JSON.parse(await readFile(MAP_FILE, "utf8"))
  let failed = false

  for (const row of map) {
    const keyNeedle = JSON.stringify(row.key)
    const fn = JET_COMMAND_KEY[row.jet] ?? row.jet.split(".").pop()
    const fnNeedle = `cmd.${fn}`
    if (!src.includes(keyNeedle) || !src.includes(fnNeedle)) {
      console.error(
        `MISSING ${row.vscode} (${row.key}) → ${fnNeedle} in default-keybindings.ts — run pnpm extract:vscode-keybindings`,
      )
      failed = true
    }
  }

  const bindingCount = (src.match(/\bbind\(/g) ?? []).length
  console.log(`default-keybindings.ts: ${bindingCount} bind() calls, ${map.length} implemented mappings checked`)

  if (failed) process.exit(1)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
