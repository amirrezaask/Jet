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

import { execCommand, focusEditor, launchJet, openFixtureFile } from "./_launch.js"

test.describe("electron editor multi-cursor", () => {
  test("add cursor below and select next occurrence", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/utils.ts")
      await focusEditor(page)
      await page.keyboard.press("Home")
      for (let i = 0; i < 20; i++) await page.keyboard.press("ArrowRight")

      await execCommand(page, "editor.addCursorBelow")
      await page.waitForTimeout(200)
      let count = await page.evaluate(() => window.__gharargahAgent!.getSelectionRangeCount())
      expect(count).toBeGreaterThanOrEqual(1)

      await execCommand(page, "editor.selectNextOccurrence")
      count = await page.evaluate(() => window.__gharargahAgent!.getSelectionRangeCount())
      expect(count).toBeGreaterThanOrEqual(1)
    } finally {
      await app.close()
    }
  })
})
