import { expect, test } from "@playwright/test"
import { execCommand, launchJet, openFixtureFile } from "./_launch.js"

test.describe("electron editor find and goto", () => {
  test("find opens search UI in editor", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/index.ts")
      await execCommand(page, "editor.find")
      await expect(page.locator('input[placeholder*="Find"], input[aria-label*="Find"]').first()).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test("goto line moves cursor", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/index.ts")
      await execCommand(page, "editor.gotoLine")
      await expect(page.getByRole("dialog")).toBeVisible()
      const input = page.getByRole("dialog").locator("input").first()
      await input.fill("5")
      await page.keyboard.press("Enter")
      await page.waitForTimeout(300)

      const pos = await page.evaluate(() => window.__jetAgent!.getCursorPosition())
      expect(pos?.line).toBe(5)
    } finally {
      await app.close()
    }
  })
})
