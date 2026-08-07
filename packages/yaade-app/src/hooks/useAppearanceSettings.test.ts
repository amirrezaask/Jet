import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { normalizeThemeId } from "./useAppearanceSettings.js"

describe("normalizeThemeId", () => {
  it("migrates persisted legacy themes to their Default scheme", () => {
    for (const id of ["catppuccin-latte", "tokyonight-day"]) {
      assert.equal(normalizeThemeId(id), "default-light")
    }
    for (const id of [
      "catppuccin-mocha",
      "catppuccin-macchiato",
      "tokyonight-night",
      "tokyonight-storm",
    ]) {
      assert.equal(normalizeThemeId(id), "default-dark")
    }
  })

  it("uses the stored scheme for unknown ids", () => {
    assert.equal(normalizeThemeId("removed-theme", "light"), "default-light")
    assert.equal(normalizeThemeId("removed-theme", "dark"), "default-dark")
  })
})
