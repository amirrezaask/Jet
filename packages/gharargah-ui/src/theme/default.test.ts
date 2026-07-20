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

const glassThemeIds = ["glass-blue", "glass-red", "glass-green"]

describe("bundled Gharargah themes", () => {
  it("registers glass themes only", () => {
    assert.equal(defaultThemeId, "glass-blue")
    assert.deepEqual(
      bundledThemeList.map(theme => theme.id),
      glassThemeIds,
    )
    assert.equal(Object.keys(bundledThemes).length, 3)
  })

  it("falls back to Glass Blue for missing or invalid theme ids", () => {
    assert.equal(getThemeById(null).id, "glass-blue")
    assert.equal(getThemeById("missing").id, "glass-blue")
    assert.equal(getThemeById("ayu-dark").id, "glass-blue")
  })

  it("maps legacy color schemes to Glass Blue", () => {
    assert.equal(defaultThemeIdForScheme("dark"), "glass-blue")
    assert.equal(defaultThemeIdForScheme("light"), "glass-blue")
  })

  it("provides shell, editor, terminal, source, and swatch metadata for every theme", () => {
    for (const theme of bundledThemeList) {
      assert.equal(theme.scheme, "dark")
      assert.equal(theme.family, "Glass")
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
