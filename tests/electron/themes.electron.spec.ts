import { expect, test } from "@playwright/test"
import {
  launchJet,
  openThemePicker,
  waitForMux,
} from "./_launch.js"

test.describe("themes", () => {
  test("Default Light and Dark change terminal background", async () => {
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
      const darkBackground = await readBg()
      await page.locator('[data-yaade-theme-option="default-light"]').click()
      await expect.poll(readBg).not.toBe(darkBackground)
      await expect
        .poll(() => page.evaluate(() => document.documentElement.classList.contains("dark")))
        .toBe(false)

      await page.locator('[data-yaade-theme-option="default-dark"]').click()
      await expect.poll(readBg).toBe(darkBackground)
      await expect
        .poll(() => page.evaluate(() => document.documentElement.classList.contains("dark")))
        .toBe(true)
    } finally {
      await app.close()
    }
  })
})
