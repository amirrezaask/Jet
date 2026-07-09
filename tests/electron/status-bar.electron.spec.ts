import { expect, test } from "@playwright/test"
import { focusEditor, hasTypescriptLanguageServer, launchJet, openFixtureFile, waitForLspConnected } from "./_launch.js"

const lspAvailable = hasTypescriptLanguageServer()

test.describe("electron status bar", () => {
  test("shows workspace path and updates line/col on cursor move", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/index.ts")
      await expect(page.locator("[data-jet-status-zone]").first()).toContainText(/sample-workspace/i)

      await focusEditor(page)
      await page.keyboard.press("End")
      const pos = await page.evaluate(() => window.__jetAgent!.getCursorPosition())
      expect(pos).not.toBeNull()
      await expect(page.locator("footer")).toContainText(`Ln ${pos!.line}`)
    } finally {
      await app.close()
    }
  })

  test("LSP zone shows connected when language server available", async () => {
    test.skip(!lspAvailable, "typescript-language-server not on PATH")
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/index.ts")
      await waitForLspConnected(page)
      await expect(page.locator("footer")).toContainText(/LSP connected/i)
    } finally {
      await app.close()
    }
  })
})
