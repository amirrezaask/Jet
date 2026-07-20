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

import { launchJet, openFixtureFile, typeInEditor } from "./_launch.js"

test.describe("electron editor undo redo", () => {
  test("Cmd-z undoes typing and Cmd-Shift-z redoes", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/utils.ts")
      const before = await page.evaluate(() => window.__gharargahAgent!.getEditorText())
      await typeInEditor(page, "X")
      await page.keyboard.press("Meta+z")
      await page.waitForTimeout(200)
      const afterUndo = await page.evaluate(() => window.__gharargahAgent!.getEditorText())
      expect(afterUndo).toBe(before)

      await page.keyboard.press("Meta+Shift+z")
      await page.waitForTimeout(200)
      const afterRedo = await page.evaluate(() => window.__gharargahAgent!.getEditorText())
      expect(afterRedo).toContain("X")
    } finally {
      await app.close()
    }
  })
})
