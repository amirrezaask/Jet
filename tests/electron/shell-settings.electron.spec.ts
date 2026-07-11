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

test.describe("electron shell settings", () => {
  test("settings overlay lists themes and reset restores appearance", async () => {
    const { app, page } = await launchJet()
    try {
      await page.evaluate(() => localStorage.clear())
      await execCommand(page, "ui.setTheme.ayu-dark")
      await execCommand(page, "settings.show")

      await expectSelectorVisible(page, "[data-jet-settings-overlay]")
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
      await execCommand(page, "ui.showThemePicker")
      await expectSelectorVisible(page, "[data-jet-settings-overlay]")
    } finally {
      await app.close()
    }
  })
})
