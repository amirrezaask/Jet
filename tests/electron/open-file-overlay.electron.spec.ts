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

import { describeFlaky } from "./_flaky.js"
import { confirmOverlay, execCommand, launchJet } from "./_launch.js"

describeFlaky("electron open file overlay", () => {
  test("workspace.openFile opens path overlay and selects fixture file", async () => {
    const { app, page } = await launchJet()
    try {
      await execCommand(page, "workspace.openFile")
      await expectLocatorVisible(page.getByRole("dialog"))
      const input = page.getByRole("dialog").locator("input").first()
      await input.fill("src/utils.ts")
      await confirmOverlay(page)
      await page.evaluate(() => window.__jetAgent!.waitForEditor())
      await expectContainsText(page, ".cm-editor", "export function greet")
    } finally {
      await app.close()
    }
  })
})
