import { expect, test } from "@playwright/test"
import { execCommand, launchJet, openFixtureFile } from "./_launch.js"

test.describe("electron close clean buffer", () => {
  test("closes without confirm when buffer is clean", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/utils.ts")
      const before = await page.evaluate(() => window.__jetAgent!.getState().openBuffers.length)
      expect(before).toBeGreaterThan(0)

      await execCommand(page, "workspace.closeBuffer")
      await expect(page.locator('[data-jet-confirm="accept"]')).toHaveCount(0)
      await page.waitForTimeout(300)
    } finally {
      await app.close()
    }
  })
})
