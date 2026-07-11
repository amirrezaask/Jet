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
  expectLocatorContainsText,
  expectNotContainsText,
} from "../shell/assert.js"

import { execCommand, launchJet, openQuickOpen } from "./_launch.js"

test.describe("electron quick open", () => {
  test("lists matching files and opens selection", async () => {
    const { app, page } = await launchJet()
    try {
      await openQuickOpen(page)
      const input = page.getByRole("dialog").getByRole("combobox")
      await input.fill("utils")
      await page.waitForTimeout(800)
      await expectLocatorContainsText(page.getByRole("dialog"), "utils.ts")
      await page.getByRole("option").filter({ hasText: "utils.ts" }).first().click()
      await page.evaluate(() => window.__jetAgent!.waitForEditor())
      await expectContainsText(page, ".cm-editor", "export function greet")
    } finally {
      await app.close()
    }
  })
})
