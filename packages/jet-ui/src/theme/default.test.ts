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

describe("bundled Jet themes", () => {
  it("registers Ayu, Everforest, Gruvbox, and TokyoNight in dark and light variants", () => {
    assert.equal(defaultThemeId, "ayu-dark")
    assert.deepEqual(
      bundledThemeList.map(theme => theme.id),
      [
        "ayu-dark",
        "ayu-light",
        "everforest-dark",
        "everforest-light",
        "gruvbox-dark",
        "gruvbox-light",
        "tokyonight-dark",
        "tokyonight-light",
      ],
    )
    assert.equal(Object.keys(bundledThemes).length, 8)
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
})
