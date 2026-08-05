import { expect, test } from "@playwright/test"
import {
  launchJet,
  openThemePicker,
  waitForMux,
} from "./_launch.js"

test.describe("themes", () => {
  test("Catppuccin Mocha and Tokyo Night change terminal background", async () => {
    const { app, page } = await launchJet()
    try {
      await waitForMux(page)

      const readBg = async () =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement)
            .getPropertyValue("--yaade-bg")
            .trim(),
        )

      await openThemePicker(page)
      await page.locator('[data-yaade-theme-option="catppuccin-mocha"]').click()
      await expect
        .poll(readBg)
        .toBe("#1e1e2e")

      await page.locator('[data-yaade-theme-option="tokyonight-night"]').click()
      await expect
        .poll(readBg)
        .toBe("#1a1b26")
    } finally {
      await app.close()
    }
  })
})
