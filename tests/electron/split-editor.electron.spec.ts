import { expect, test } from "@playwright/test"
import { execCommand, focusEditor, launchJet, openFixtureFile } from "./_launch.js"

test.describe("electron split editor", () => {
  test("view.splitEditor creates a second editor panel", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/index.ts")
      await execCommand(page, "view.splitEditor")
      await page.waitForTimeout(500)

      const panels = await page.evaluate(() => window.__jetAgent!.getState().panels)
      expect(panels.length).toBeGreaterThanOrEqual(2)
      await expect(page.locator(".cm-editor").first()).toBeVisible()
    } finally {
      await app.close()
    }
  })
})
