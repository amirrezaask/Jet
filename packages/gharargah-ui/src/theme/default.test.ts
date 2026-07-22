import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  bundledThemeList,
  bundledThemes,
  defaultThemeId,
  defaultThemeIdForScheme,
  getThemeById,
  siblingThemeForScheme,
  themePreviewSwatches,
  themeUsesGlassSurface,
} from "./default.js"

const themeIds = [
  "default-dark",
  "default-light",
  "glass-blue",
  "glass-red",
  "glass-green",
]

describe("bundled Gharargah themes", () => {
  it("registers shadcn defaults first, then glass themes", () => {
    assert.equal(defaultThemeId, "default-dark")
    assert.deepEqual(
      bundledThemeList.map(theme => theme.id),
      themeIds,
    )
    assert.equal(Object.keys(bundledThemes).length, 5)
  })

  it("falls back to Default Dark for missing or invalid theme ids", () => {
    assert.equal(getThemeById(null).id, "default-dark")
    assert.equal(getThemeById("missing").id, "default-dark")
    assert.equal(getThemeById("ayu-dark").id, "default-dark")
  })

  it("maps color schemes to matching Default themes", () => {
    assert.equal(defaultThemeIdForScheme("dark"), "default-dark")
    assert.equal(defaultThemeIdForScheme("light"), "default-light")
    assert.equal(siblingThemeForScheme("default-dark", "light").id, "default-light")
    assert.equal(siblingThemeForScheme("glass-blue", "light").id, "glass-blue")
  })

  it("marks only Glass family as optical-glass surface", () => {
    assert.equal(themeUsesGlassSurface(getThemeById("default-dark")), false)
    assert.equal(themeUsesGlassSurface(getThemeById("default-light")), false)
    assert.equal(themeUsesGlassSurface(getThemeById("glass-blue")), true)
  })

  it("provides shell, editor, terminal, source, and swatch metadata for every theme", () => {
    for (const theme of bundledThemeList) {
      assert.ok(theme.scheme === "dark" || theme.scheme === "light")
      assert.ok(theme.family === "Default" || theme.family === "Glass")
      assert.ok(theme.sourceUrl?.startsWith("https://"))
      assert.ok(theme.colors.bg)
      assert.ok(theme.colors.panel)
      assert.ok(theme.highlights.keyword)
      assert.ok(theme.highlights.string)
      assert.ok(theme.terminalAnsi?.red)
      assert.ok(theme.terminalAnsi?.brightWhite)
      assert.ok(themePreviewSwatches(theme).length >= 4)
      if (theme.family === "Default") {
        assert.ok(theme.shadcn)
      }
    }
  })
})
