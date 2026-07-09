import { expect, test } from "@playwright/test"
import { launchJet, openFixtureFile } from "./_launch.js"

test.describe("electron editor input focus", () => {
  test("types into editor after waitForEditor focuses cm surface", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/index.ts")
      await page.keyboard.type("focus-test")
      const text = await page.evaluate(() => window.__jetAgent!.getEditorText())
      expect(text).toContain("focus-test")
    } finally {
      await app.close()
    }
  })
})
