import { expect, test } from "@playwright/test"
import { execCommand, focusEditor, launchJet, openFixtureFile } from "./_launch.js"

test.describe("electron jump stack", () => {
  test("jumpBack and jumpForward restore buffers", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/index.ts")
      await openFixtureFile(page, "src/utils.ts")
      await focusEditor(page)

      await execCommand(page, "navigation.jumpBack")
      await focusEditor(page)
      await page.waitForTimeout(300)
      const backText = await page.evaluate(() => window.__jetAgent!.getEditorText())
      expect(backText).toContain("main")

      await execCommand(page, "navigation.jumpForward")
      const forwardText = await page.evaluate(() => window.__jetAgent!.getEditorText())
      expect(forwardText).toContain("greet")
    } finally {
      await app.close()
    }
  })
})
