import { expect, test } from "@playwright/test"
import { confirmOverlay, execCommand, launchJet, REPO_ROOT } from "./_launch.js"

test.describe("electron cd overlay", () => {
  test("workspace.cd switches active workspace path", async () => {
    const { app, page } = await launchJet(".")
    try {
      const target = `${REPO_ROOT}/fixtures/sample-workspace`
      await execCommand(page, "workspace.cd")
      await expect(page.getByRole("dialog")).toBeVisible()
      const input = page.getByRole("dialog").locator("input").first()
      await input.fill(target)
      await confirmOverlay(page)
      await page.waitForTimeout(1000)

      await expect
        .poll(() => page.evaluate(() => window.__jetAgent!.getState().activeWorkspace))
        .toContain("sample-workspace")
    } finally {
      await app.close()
    }
  })
})
