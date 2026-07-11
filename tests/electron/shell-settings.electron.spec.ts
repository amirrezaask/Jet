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

import { execCommand, launchJet, openSettings, openThemePicker } from "./_launch.js"

test.describe("electron shell settings", () => {
  test("settings overlay lists themes and reset restores appearance", async () => {
    const { app, page } = await launchJet()
    try {
      await page.evaluate(() => localStorage.clear())
      await page.evaluate(async () => window.__jetAgent!.waitForReady())
      await execCommand(page, "ui.setTheme.ayu-dark")
      await openSettings(page)
      await expectLocatorCount(page.locator("[data-jet-theme-option]"), 8)

      await page.locator("[data-jet-theme-option='gruvbox-light']").click()
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem("jet-theme-id")))
        .toBe("gruvbox-light")

      await execCommand(page, "ui.resetAppearance")
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem("jet-theme-id")))
        .not.toBe("gruvbox-light")
    } finally {
      await app.close()
    }
  })

  test("theme picker command opens settings overlay", async () => {
    const { app, page } = await launchJet()
    try {
      await openThemePicker(page)
    } finally {
      await app.close()
    }
  })
})
