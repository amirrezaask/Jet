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

test.describe("electron focus panels", () => {
  test("focus sidebar and editor commands run without error", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/index.ts")
      await execCommand(page, "explorer.show")
      await execCommand(page, "workbench.action.focusSideBar")
      await execCommand(page, "workbench.action.focusFirstEditorGroup")
      await focusEditor(page)
      await expectLocatorVisible(page.locator(".cm-editor").first())
    } finally {
      await app.close()
    }
  })
})
