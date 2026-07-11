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

import { execCommand, launchJet, typeInEditor } from "./_launch.js"

test.describe("electron new file", () => {
  test("creates untitled editor in main panel and marks dirty after edit", async () => {
    const { app, page } = await launchJet()
    try {
      await execCommand(page, "workspace.newFile")
      await page.evaluate(() => window.__jetAgent!.waitForEditor())
      await expectSelectorVisible(page, ".cm-editor")

      const panels = await page.evaluate(() => window.__jetAgent!.getState().panels)
      const editorPanels = panels.filter(p => p.kind === "editor")
      expect(editorPanels.length).toBeGreaterThanOrEqual(1)

      await typeInEditor(page, "untitled content")
      await expect
        .poll(() => page.evaluate(() => window.__jetAgent!.getState().activeEditorDirty))
        .toBe(true)
    } finally {
      await app.close()
    }
  })
})
