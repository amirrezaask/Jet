#!/usr/bin/env node
/**
 * Parse RAD Debugger theme presets from raddbg.mdesk and emit GharargahTheme definitions.
 *
 * Usage:
 *   node packages/gharargah-ui/scripts/import-raddebugger-themes.mjs [path-to-raddbg.mdesk]
 *
 * Default source: fetched from EpicGames/raddebugger on GitHub (master).
 */

import { writeFileSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const outPath = join(__dirname, "../src/theme/raddebugger.ts")
const defaultMdeskUrl =
  "https://raw.githubusercontent.com/EpicGames/raddebugger/master/src/raddbg/raddbg.mdesk"

async function loadMdesk(pathOrUrl) {
  if (pathOrUrl) {
    return readFileSync(pathOrUrl, "utf8")
  }
  const res = await fetch(defaultMdeskUrl)
  if (!res.ok) throw new Error(`Failed to fetch ${defaultMdeskUrl}: ${res.status}`)
  return res.text()
}

function normalizeRadHex(raw) {
  const hex = raw.replace(/^0x/i, "").replace(/[,;}\s].*$/, "")
  const padded = hex.padStart(8, "0").slice(-8)
  const r = padded.slice(0, 2)
  const g = padded.slice(2, 4)
  const b = padded.slice(4, 6)
  return `#${r}${g}${b}`.toLowerCase()
}

function parseThemes(mdesk) {
  const tableStart = mdesk.indexOf("RD_ThemePresetTable:")
  if (tableStart < 0) throw new Error("RD_ThemePresetTable not found")

  const themes = []
  const blockRe =
    /\{\s*([A-Za-z0-9_]+)\s+([a-z0-9_]+)\s+"([^"]+)",\s*```theme:\s*\{([\s\S]*?)\}\s*```\s*\}/g

  let match
  const slice = mdesk.slice(tableStart)
  while ((match = blockRe.exec(slice)) !== null) {
    const [, , slug, displayName, body] = match
    const colors = {}
    const colorRe = /theme_color:\{[^}]*tags:\s*([^,}]+)[^}]*value:\s*(0x[0-9a-fA-F]+)/g
    let colorMatch
    while ((colorMatch = colorRe.exec(body)) !== null) {
      const tag = colorMatch[1].trim().replace(/^"|"$/g, "")
      colors[tag] = normalizeRadHex(colorMatch[2])
    }
    themes.push({ slug, displayName, colors })
  }

  if (themes.length === 0) throw new Error("No themes parsed from mdesk")
  return themes
}

function pick(colors, ...tags) {
  for (const tag of tags) {
    if (colors[tag]) return colors[tag]
  }
  return "#808080"
}

function jetId(slug) {
  return `rad-${slug.replace(/_/g, "-")}`
}

function schemeFor(displayName, slug) {
  if (/light/i.test(displayName) || slug.endsWith("_light")) return "light"
  return "dark"
}

function exportName(slug) {
  const base = slug
    .split("_")
    .map((part, i) => (i === 0 ? part : part[0].toUpperCase() + part.slice(1)))
    .join("")
  return `rad${base[0].toUpperCase()}${base.slice(1)}`
}

function emitTheme({ slug, displayName, colors }) {
  const id = jetId(slug)
  const scheme = schemeFor(displayName, slug)
  const varName = exportName(slug)

  return `export const ${varName} = makeTheme({
  id: "${id}",
  name: "${displayName}",
  family: "RAD",
  scheme: "${scheme}",
  sourceName: "EpicGames/raddebugger",
  sourceUrl: "${defaultMdeskUrl}",
  license: "MIT",
  colors: paletteColors({
    bg: "${pick(colors, "background")}",
    panel: "${pick(colors, "alt background", "background")}",
    panelRaised: "${pick(colors, "tab background", "floating background", "alt background", "background")}",
    text: "${pick(colors, "text", "code_default")}",
    textMuted: "${pick(colors, "weak text")}",
    accent: "${pick(colors, "focus border", "cursor")}",
    hover: "${pick(colors, "match background", "pop background", "alt background")}",
    selection: "${pick(colors, "selection", "match background")}",
    border: "${pick(colors, "border")}",
    focusBorder: "${pick(colors, "focus border", "cursor")}",
    error: "${pick(colors, "bad text")}",
    warning: "${pick(colors, "neutral text")}",
    success: "${pick(colors, "good text")}",
  }),
  highlights: paletteHighlights({
    keyword: "${pick(colors, "code_keyword")}",
    function: "${pick(colors, "code_symbol", "code_function")}",
    type: "${pick(colors, "code_type")}",
    string: "${pick(colors, "code_string")}",
    number: "${pick(colors, "code_numeric")}",
    comment: "${pick(colors, "code_comment")}",
    operator: "${pick(colors, "code_delimiter_or_operator")}",
    variable: "${pick(colors, "code_default", "code_local")}",
    attribute: "${pick(colors, "code_meta")}",
    constant: "${pick(colors, "code_register")}",
    field: "${pick(colors, "code_local")}",
    module: "${pick(colors, "code_type")}",
  }),
  terminalAnsi: paletteAnsi({
    black: "${pick(colors, "background")}",
    red: "${pick(colors, "bad text")}",
    green: "${pick(colors, "good text", "code_string")}",
    yellow: "${pick(colors, "thread_0", "code_symbol")}",
    blue: "${pick(colors, "neutral text", "focus border")}",
    magenta: "${pick(colors, "code_meta", "code_register")}",
    cyan: "${pick(colors, "code_local", "thread_1")}",
    white: "${pick(colors, "text", "code_default")}",
    brightBlack: "${pick(colors, "weak text")}",
    brightRed: "${pick(colors, "bad text")}",
    brightGreen: "${pick(colors, "good text")}",
    brightYellow: "${pick(colors, "thread_0")}",
    brightBlue: "${pick(colors, "neutral text")}",
    brightMagenta: "${pick(colors, "code_register")}",
    brightCyan: "${pick(colors, "code_local")}",
    brightWhite: "${pick(colors, "text")}",
  }),
})`
}

function emitFile(themes) {
  const exports = themes.map(emitTheme).join("\n\n")
  const ids = themes.map(t => `  [${exportName(t.slug)}.id]: ${exportName(t.slug)},`).join("\n")
  const list = themes.map(t => exportName(t.slug)).join(",\n  ")

  return `// Generated by packages/gharargah-ui/scripts/import-raddebugger-themes.mjs — do not edit by hand.
import {
  makeTheme,
  paletteAnsi,
  paletteColors,
  paletteHighlights,
} from "./theme-palette.js"

${exports}

export const radDebuggerThemes = {
${ids}
}

export const radDebuggerThemeList = [
  ${list},
]
`
}

async function main() {
  const input = process.argv[2]
  const mdesk = await loadMdesk(input)
  const themes = parseThemes(mdesk)
  const file = emitFile(themes)
  writeFileSync(outPath, file, "utf8")
  console.log(`Wrote ${themes.length} RAD themes to ${outPath}`)
  for (const theme of themes) {
    console.log(`  - ${jetId(theme.slug)} (${theme.displayName})`)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
