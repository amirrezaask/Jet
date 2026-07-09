import { expect, test } from "@playwright/test"
import { execCommand, launchJet, openFixtureFile } from "./_launch.js"

test.describe("electron buffer list", () => {
  test("lists open buffers and switches active file", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/index.ts")
      await openFixtureFile(page, "src/utils.ts")

      await execCommand(page, "workspace.bufferList")
      await expect(page.getByRole("dialog")).toBeVisible()
      await expect(page.getByRole("dialog")).toContainText("index.ts")
      await expect(page.getByRole("dialog")).toContainText("utils.ts")

      await page.getByRole("option", { name: /index\.ts/i }).click()
      await page.evaluate(() => window.__jetAgent!.waitForEditor())
      await expect(page.locator(".cm-editor")).toContainText("main()")
    } finally {
      await app.close()
    }
  })
})
