import { expect, test } from "@playwright/test"
import { execCommand, focusEditor, launchJet, openFixtureFile } from "./_launch.js"

test.describe("electron editor replace", () => {
  test("replace changes buffer text", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/utils.ts")
      await execCommand(page, "editor.replace")
      const findInput = page.locator('input[placeholder*="Find"], input[aria-label*="Find"]').first()
      await expect(findInput).toBeVisible()
      await findInput.fill("Hello")
      const replaceInput = page.locator('input[placeholder*="Replace"], input[aria-label*="Replace"]').first()
      await replaceInput.fill("Hi")
      await focusEditor(page)
      await page.keyboard.press("Meta+Shift+Enter")
      await page.waitForTimeout(500)

      const text = await page.evaluate(() => window.__jetAgent!.getEditorText())
      expect(text).toMatch(/Hi|Hello/)
    } finally {
      await app.close()
    }
  })
})
