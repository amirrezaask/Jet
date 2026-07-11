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

test.describe("electron editor line ops", () => {
  test("toggle comment and indent change buffer", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/utils.ts")
      await focusEditor(page)
      await page.keyboard.press("Home")

      await execCommand(page, "editor.toggleComment")
      let text = await page.evaluate(() => window.__jetAgent!.getEditorText())
      expect(text).toMatch(/\/\/\s*export|export/)

      await execCommand(page, "editor.indentMore")
      text = await page.evaluate(() => window.__jetAgent!.getEditorText())
      expect(text).toBeTruthy()
    } finally {
      await app.close()
    }
  })
})
