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

test.describe("electron buffer cycle", () => {
  test("nextEditor and previousEditor cycle buffers", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/index.ts")
      await openFixtureFile(page, "src/utils.ts")
      await openFixtureFile(page, "src/index.ts")

      await execCommand(page, "editor.nextEditor")
      await focusEditor(page)
      await page.waitForTimeout(200)
      const afterNext = await page.evaluate(() => window.__jetAgent!.getEditorText())
      expect(afterNext).toContain("greet")

      await execCommand(page, "editor.previousEditor")
      await focusEditor(page)
      await page.waitForTimeout(200)
      const afterPrev = await page.evaluate(() => window.__jetAgent!.getEditorText())
      expect(afterPrev).toContain("main")
    } finally {
      await app.close()
    }
  })
})
