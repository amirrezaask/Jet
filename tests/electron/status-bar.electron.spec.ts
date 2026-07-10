import { expect, test } from "@playwright/test"
import { resolve } from "node:path"
import { focusEditor, launchJet, openFixtureFile, REPO_ROOT } from "./_launch.js"

test.describe("electron workspace chrome", () => {
  test("shows the active project in the titlebar and updates on project switch", async () => {
    const { app, page } = await launchJet()
    const secondPath = resolve(REPO_ROOT, "fixtures/second-workspace")
    try {
      const titlebar = page.locator("[data-jet-titlebar-main]")
      await expect(titlebar).toContainText("sample-workspace")

      await page.evaluate(path => window.__jetAgent!.openWorkspace(path), secondPath)
      await expect(titlebar).toContainText("second-workspace")
      await expect(page.locator("[data-jet-status-zone]")).toHaveCount(0)
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
      await expect(page.locator("footer")).toHaveCount(0)
    } finally {
      await app.close()
    }
  })
})
