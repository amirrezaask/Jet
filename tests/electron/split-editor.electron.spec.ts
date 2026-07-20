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

test.describe("electron split editor", () => {
  test("view.splitEditor creates a second editor panel", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/index.ts")
      await execCommand(page, "view.splitEditor")
      await page.waitForTimeout(500)

      const panels = await page.evaluate(() => window.__gharargahAgent!.getState().panels)
      expect(panels.length).toBeGreaterThanOrEqual(2)
      await expectLocatorVisible(page.locator(".cm-editor").first())
    } finally {
      await app.close()
    }
  })
})
