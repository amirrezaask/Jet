import { expect, test } from "@playwright/test"
import { expectLocatorCount } from "../shell/assert.js"

import { execCommand, launchJet, openSettings, openThemePicker } from "./_launch.js"

test.describe("electron shell settings", () => {
  test("settings overlay lists themes and reset restores appearance", async () => {
    const { app, page } = await launchJet()
    try {
      await page.evaluate(() => localStorage.clear())
      await page.evaluate(async () => window.__gharargahAgent!.waitForReady())
      await execCommand(page, "ui.setTheme.glass-blue")
      await openSettings(page)
      await expectLocatorCount(page.locator("[data-gharargah-theme-option]"), 5)

      await page.locator("[data-gharargah-theme-option='glass-red']").click()
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem("jet-theme-id")))
        .toBe("glass-red")

      await page.locator("[data-gharargah-font-preset='ui:system']").click()
      await expect
        .poll(() =>
          page.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim(),
          ),
        )
        .toContain("system-ui")

      await page.locator("[data-gharargah-font-preset='mono:ibm-plex-mono']").click()
      await expect
        .poll(() =>
          page.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim(),
          ),
        )
        .toContain("IBM Plex Mono")

      await execCommand(page, "ui.resetAppearance")
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem("jet-theme-id")))
        .toBe("default-dark")
      await expect
        .poll(() =>
          page.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim(),
          ),
        )
        .toContain("Geist")
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
