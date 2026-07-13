import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  bundledThemeList,
  bundledThemes,
  defaultThemeId,
  defaultThemeIdForScheme,
  getThemeById,
  themePreviewSwatches,
} from "./default.js"

const paletteThemeIds = [
  "ayu-dark",
  "ayu-light",
  "everforest-dark",
  "everforest-light",
  "gruvbox-dark",
  "gruvbox-light",
  "tokyonight-dark",
  "tokyonight-light",
]

const radThemeIds = [
  "rad-default-dark",
  "rad-default-light",
  "rad-vs-dark",
  "rad-vs-light",
  "rad-solarized-dark",
  "rad-solarized-light",
  "rad-handmade-hero",
  "rad-naysayer",
  "rad-four-coder",
  "rad-grove",
  "rad-far-manager",
]

describe("bundled Jet themes", () => {
  it("registers palette themes plus RAD Debugger imports", () => {
    assert.equal(defaultThemeId, "ayu-dark")
    assert.deepEqual(bundledThemeList.map(theme => theme.id), [
      ...paletteThemeIds,
      ...radThemeIds,
    ])
    assert.equal(Object.keys(bundledThemes).length, 19)
  })

  it("falls back to Ayu Dark for missing or invalid theme ids", () => {
    assert.equal(getThemeById(null).id, "ayu-dark")
    assert.equal(getThemeById("missing").id, "ayu-dark")
  })

  it("maps legacy color schemes to Ayu variants", () => {
    assert.equal(defaultThemeIdForScheme("dark"), "ayu-dark")
    assert.equal(defaultThemeIdForScheme("light"), "ayu-light")
  })

  it("provides shell, editor, terminal, source, and swatch metadata for every theme", () => {
    for (const theme of bundledThemeList) {
      assert.ok(theme.scheme === "dark" || theme.scheme === "light")
      assert.ok(theme.family)
      assert.ok(theme.sourceUrl?.startsWith("https://"))
      assert.ok(theme.colors.bg)
      assert.ok(theme.colors.panel)
      assert.ok(theme.highlights.keyword)
      assert.ok(theme.highlights.string)
      assert.ok(theme.terminalAnsi?.red)
      assert.ok(theme.terminalAnsi?.brightWhite)
      assert.ok(themePreviewSwatches(theme).length >= 4)
    }
  })

  it("imports RAD Debugger themes from raddbg.mdesk", () => {
    const radDefaultDark = getThemeById("rad-default-dark")
    assert.equal(radDefaultDark.family, "RAD")
    assert.equal(radDefaultDark.name, "Default (Dark)")
    assert.equal(radDefaultDark.colors.bg, "#1f1f1f")
    assert.equal(radDefaultDark.highlights.keyword, "#838b8f")
    assert.equal(getThemeById("rad-four-coder").name, "4coder")
  })
})
