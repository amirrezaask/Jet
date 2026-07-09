import { expect, test } from "@playwright/test"
import { confirmOverlay, execCommand, launchJet } from "./_launch.js"

test.describe("electron open file overlay", () => {
  test("workspace.openFile opens path overlay and selects fixture file", async () => {
    const { app, page } = await launchJet()
    try {
      await execCommand(page, "workspace.openFile")
      await expect(page.getByRole("dialog")).toBeVisible()
      const input = page.getByRole("dialog").locator("input").first()
      await input.fill("src/utils.ts")
      await confirmOverlay(page)
      await page.evaluate(() => window.__jetAgent!.waitForEditor())
      await expect(page.locator(".cm-editor")).toContainText("export function greet")
    } finally {
      await app.close()
    }
  })
})
