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

import { execCommand, launchJet, openFixtureFile } from "./_launch.js"

test.describe("electron close clean buffer", () => {
  test("closes without confirm when buffer is clean", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/utils.ts")
      const before = await page.evaluate(() => window.__jetAgent!.getState().openBuffers.length)
      expect(before).toBeGreaterThan(0)

      await execCommand(page, "workspace.closeBuffer")
      await expectLocatorCount(page.locator('[data-jet-confirm="accept"]'), 0)
      await page.waitForTimeout(300)
    } finally {
      await app.close()
    }
  })

  test("native close accelerator reaches the shared close-buffer command", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/utils.ts")
      const before = await page.evaluate(() => window.__jetAgent!.getState().openBuffers.length)

      await page.keyboard.press(process.platform === "darwin" ? "Meta+w" : "Control+w")

      await expect
        .poll(() => page.evaluate(() => window.__jetAgent!.getState().openBuffers.length))
        .toBe(before - 1)
    } finally {
      await app.close()
    }
  })
})
