import { expect, test } from "@playwright/test"
import { execCommand, launchJet } from "./_launch.js"

test.describe("electron shell settings", () => {
  test("settings overlay lists themes and reset restores appearance", async () => {
    const { app, page } = await launchJet()
    try {
      await page.evaluate(() => localStorage.clear())
      await execCommand(page, "ui.setTheme.ayu-dark")
      await execCommand(page, "settings.show")

      await expect(page.locator("[data-jet-settings-overlay]")).toBeVisible()
      await expect(page.locator("[data-jet-theme-option]")).toHaveCount(8)

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
      await expect(page.locator("[data-jet-settings-overlay]")).toBeVisible()
    } finally {
      await app.close()
    }
  })
})
