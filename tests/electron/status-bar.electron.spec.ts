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

import { resolve } from "node:path"
import { focusEditor, launchJet, openFixtureFile, REPO_ROOT } from "./_launch.js"

test.describe("electron workspace chrome", () => {
  test("shows the active project in the status bar and updates on project switch", async () => {
    const { app, page } = await launchJet()
    const secondPath = resolve(REPO_ROOT, "fixtures/second-workspace")
    try {
      const footer = page.locator("footer")
      await expectLocatorContainsText(footer, "sample-workspace")

      await page.evaluate(path => window.__jetAgent!.openWorkspace(path), secondPath)
      await expectLocatorContainsText(footer, "second-workspace")
      await expectLocatorCount(page.locator("footer"), 1)
    } finally {
      await app.close()
    }
  })

  test("tracks editor cursor state without permanent status-bar chrome", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/index.ts")
      await focusEditor(page)
      await page.evaluate(() => window.__jetAgent!.setEditorSelection(2, 1))
      await expect
        .poll(() => page.evaluate(() => window.__jetAgent!.getCursorPosition()))
        .toEqual({ line: 2, column: 1 })
      await expectLocatorCount(page.locator("footer"), 1)
      await expectLocatorContainsText(page.locator("footer"), "index.ts")
    } finally {
      await app.close()
    }
  })
})
