import { expect, test } from "@playwright/test"
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
      const before = await page.evaluate(() => window.__jetAgent!.getState().fontSize)
      await execCommand(page, "ui.zoomIn")
      const afterIn = await page.evaluate(() => window.__jetAgent!.getState().fontSize)
      expect(afterIn).toBeGreaterThan(before)

      await execCommand(page, "ui.zoomOut")
      const afterOut = await page.evaluate(() => window.__jetAgent!.getState().fontSize)
      expect(afterOut).toBeLessThanOrEqual(afterIn)
    } finally {
      await app.close()
    }
  })
})
