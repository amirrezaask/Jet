import { expect, test } from "@playwright/test"
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
      await expect(page.locator(".cm-editor").first()).toBeVisible()
    } finally {
      await app.close()
    }
  })
})
