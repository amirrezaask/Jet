import { expect, test } from "@playwright/test"

import { execCommand, launchJet } from "./_launch.js"

test.describe("electron zoom", () => {
  test("zoom commands change reported font size", async () => {
    const { app, page } = await launchJet()
    try {
      await page.evaluate(() => {
        localStorage.removeItem("jet-font-size")
        localStorage.removeItem("jet-appearance-settings")
        window.__yaadeAgent!.setFontSize(13)
      })
      await expect
        .poll(() => page.evaluate(() => window.__yaadeAgent!.getState().fontSize))
        .toBe(13)

      const before = await page.evaluate(() => window.__yaadeAgent!.getState().fontSize)
      await execCommand(page, "ui.zoomIn")
      await expect
        .poll(() => page.evaluate(() => window.__yaadeAgent!.getState().fontSize))
        .toBeGreaterThan(before)
      const afterIn = await page.evaluate(() => window.__yaadeAgent!.getState().fontSize)

      await execCommand(page, "ui.zoomOut")
      await expect
        .poll(() => page.evaluate(() => window.__yaadeAgent!.getState().fontSize))
        .toBeLessThanOrEqual(afterIn)
      const afterOut = await page.evaluate(() => window.__yaadeAgent!.getState().fontSize)
      expect(afterOut).toBeLessThanOrEqual(afterIn)
    } finally {
      await app.close()
    }
  })
})
