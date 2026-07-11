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

import { execCommand, launchJet, openQuickOpen, waitForDialog } from "./_launch.js"

test.describe("electron quick open", () => {
  test("returns files while the workspace search index is still warming", async () => {
    const { app, page } = await launchJet()
    try {
      await page.evaluate(async () => window.__jetAgent!.executeCommand("workspace.quickOpen"))
      await waitForDialog(page)
      const input = page.getByRole("dialog").getByRole("combobox")
      await input.fill("utils")
      const option = page.getByRole("dialog").getByRole("option", { name: /utils\.ts/i })
      await expectLocatorVisible(option, { timeout: 15_000 })
    } finally {
      await app.close()
    }
  })

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
