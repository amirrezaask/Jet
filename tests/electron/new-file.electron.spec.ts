import { expect, test } from "@playwright/test"
import { execCommand, launchJet, typeInEditor } from "./_launch.js"

test.describe("electron new file", () => {
  test("creates untitled editor in main panel and marks dirty after edit", async () => {
    const { app, page } = await launchJet()
    try {
      await execCommand(page, "workspace.newFile")
      await page.evaluate(() => window.__jetAgent!.waitForEditor())
      await expect(page.locator(".cm-editor")).toBeVisible()

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
