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

import { execCommand, launchJet } from "./_launch.js"
import { expectListRows } from "../helpers/list.js"
import { EXPLORER_PANEL } from "../helpers/shell.js"

const EXPLORER_ITEMS = `${EXPLORER_PANEL} [data-jet-list-item]`

test.describe("electron explorer", () => {
  test("shows file tree and opens file from explorer", async () => {
    const { app, page } = await launchJet()
    try {
      await execCommand(page, "explorer.show")
      await expectSelectorVisible(page, EXPLORER_PANEL)
      await expectListRows(page, { panel: "jet:explorer", minItems: 1, needle: "sample-workspace" })

      await page.locator(EXPLORER_ITEMS).filter({ hasText: /^src$/i }).first().click()
      await page.waitForTimeout(400)
      await page.locator(EXPLORER_ITEMS).filter({ hasText: /utils\.ts/i }).first().click()
      await page.evaluate(() => window.__jetAgent!.waitForEditor())
      await expectContainsText(page, ".cm-editor", "export function greet")
    } finally {
      await app.close()
    }
  })
})
