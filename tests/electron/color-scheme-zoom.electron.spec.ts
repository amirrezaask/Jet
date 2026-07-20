import { expect, test } from "@playwright/test"
import {
  expectContainsText,
  expectLocatorAttached,
  expectLocatorAttribute,
  expectLocatorCount,
  expectLocatorFocused,
  expectLocatorHidden,
  expectLocatorVisible,
  expectSelectorHidden,
  expectSelectorVisible,
} from "../shell/assert.js"

import { execCommand, launchJet } from "./_launch.js"

test.describe("electron color scheme and zoom", () => {
  test("toggles light/dark scheme on document root", async () => {
    const { app, page } = await launchJet()
    try {
      await execCommand(page, "ui.setColorScheme.dark")
      await expect
        .poll(() => page.evaluate(() => document.documentElement.classList.contains("dark")))
        .toBe(true)

      await execCommand(page, "ui.setColorScheme.light")
      await expect
        .poll(() => page.evaluate(() => document.documentElement.classList.contains("dark")))
        .toBe(false)

      await execCommand(page, "ui.toggleColorScheme")
      await expect
        .poll(() => page.evaluate(() => document.documentElement.classList.contains("dark")))
        .toBe(true)
    } finally {
      await app.close()
    }
  })

  test("zoom commands change reported font size", async () => {
    const { app, page } = await launchJet()
    try {
      await page.evaluate(() => {
        localStorage.removeItem("jet-font-size")
        localStorage.removeItem("jet-appearance-settings")
        window.__gharargahAgent!.setFontSize(13)
      })
      await expect
        .poll(() => page.evaluate(() => window.__gharargahAgent!.getState().fontSize))
        .toBe(13)

      const before = await page.evaluate(() => window.__gharargahAgent!.getState().fontSize)
      await execCommand(page, "ui.zoomIn")
      await expect
        .poll(() => page.evaluate(() => window.__gharargahAgent!.getState().fontSize))
        .toBeGreaterThan(before)
      const afterIn = await page.evaluate(() => window.__gharargahAgent!.getState().fontSize)

      await execCommand(page, "ui.zoomOut")
      await expect
        .poll(() => page.evaluate(() => window.__gharargahAgent!.getState().fontSize))
        .toBeLessThanOrEqual(afterIn)
      const afterOut = await page.evaluate(() => window.__gharargahAgent!.getState().fontSize)
      expect(afterOut).toBeLessThanOrEqual(afterIn)
    } finally {
      await app.close()
    }
  })
})
