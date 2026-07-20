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

import { execCommand, launchJet, openQuickOpen, waitForDialog, REPO_ROOT } from "./_launch.js"
import { resolve } from "node:path"
import { expectListRows } from "../helpers/list.js"

test.describe("electron quick open", () => {
  test("returns files while the workspace search index is still warming", async () => {
    const { app, page } = await launchJet()
    try {
      await page.evaluate(async () => window.__gharargahAgent!.executeCommand("workspace.quickOpen"))
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
      await page.evaluate(() => window.__gharargahAgent!.waitForEditor())
      await expectContainsText(page, ".cm-editor", "export function greet")
    } finally {
      await app.close()
    }
  })

  test("filters file results to one workspace", async () => {
    const { app, page } = await launchJet()
    try {
      const secondPath = resolve(REPO_ROOT, "fixtures/second-workspace")
      await page.evaluate(path => window.__gharargahAgent!.addWorkspace(path), secondPath)
      await openQuickOpen(page)

      const scope = page.getByRole("group", { name: "Filter files by workspace" })
      await expectLocatorContainsText(scope, "All")
      await scope.getByRole("button", { name: "Only second-workspace" }).click()
      const input = page.getByRole("dialog").getByRole("combobox")
      await input.fill("marker")

      await expectListRows(page, {
        panel: "gharargah:palette",
        minItems: 1,
        needle: "src/marker.ts",
        noResultsText: "No matching files.",
      })
      await expectNotContainsText(page, '[role="dialog"]', "sample-workspace/")
    } finally {
      await app.close()
    }
  })
})
