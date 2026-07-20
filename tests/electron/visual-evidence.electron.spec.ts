import { expect, test, type TestInfo } from "@playwright/test"
import type { ShellDriver } from "../shell/driver.js"
import { expectSelectorVisible } from "../shell/assert.js"
import { execCommand, launchJet, openFixtureFile } from "./_launch.js"

async function attachScreenshot(
  testInfo: TestInfo,
  page: ShellDriver,
  name: string,
) {
  await testInfo.attach(name, {
    body: Buffer.from(await page.screenshot(), "base64"),
    contentType: "image/png",
  })
}

test("captures reviewed dark/light product states without clipping", async ({}, testInfo) => {
  const { app, page } = await launchJet()
  try {
    await openFixtureFile(page, "src/index.ts")
    await execCommand(page, "explorer.show")
    await expectSelectorVisible(page, "[data-gharargah-list-panel='gharargah:explorer']")

    await execCommand(page, "ui.showCommandPalette")
    await expectSelectorVisible(page, "[role='dialog']")
    const paletteGeometry = await page.locator("[data-slot='dialog-content']").evaluate(element => {
      const rect = element.getBoundingClientRect()
      return {
        top: rect.top,
        bottom: rect.bottom,
        viewportHeight: window.innerHeight,
      }
    })
    expect(paletteGeometry.top).toBeGreaterThanOrEqual(8)
    expect(paletteGeometry.bottom).toBeLessThanOrEqual(paletteGeometry.viewportHeight - 8)
    await attachScreenshot(testInfo, page, "dark-palette")

    await page.keyboard.press("Escape")
    await execCommand(page, "ui.toggleColorScheme")
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(false)
    await attachScreenshot(testInfo, page, "light-editor")

    await execCommand(page, "settings.show")
    await expectSelectorVisible(page, "[data-gharargah-settings-overlay]")
    await attachScreenshot(testInfo, page, "light-settings")
  } finally {
    await app.close()
  }
})
