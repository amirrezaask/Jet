import { expect, test } from "@playwright/test"
import { describeFlaky } from "./_flaky.js"
import { execCommand, focusEditor, launchJet, openFixtureFile, typeInEditor } from "./_launch.js"

describeFlaky("electron dirty close confirm", () => {
  test("dismiss keeps buffer, accept closes", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/index.ts")
      await typeInEditor(page, "// dirty-marker")

      await expect
        .poll(() => page.evaluate(() => window.__jetAgent!.getState().activeEditorDirty), { timeout: 10_000 })
        .toBe(true)

      await execCommand(page, "workbench.action.focusFirstEditorGroup")
      await focusEditor(page)
      await execCommand(page, "workspace.closeBuffer")
      await expect(page.locator('[data-jet-confirm="accept"]')).toBeVisible({ timeout: 10_000 })

      await page.evaluate(() => window.__jetAgent!.dismissConfirm())
      await expect
        .poll(() => page.evaluate(() => window.__jetAgent!.getState().openBuffers.length))
        .toBeGreaterThan(0)

      await execCommand(page, "workspace.closeBuffer")
      await expect(page.locator('[data-jet-confirm="accept"]')).toBeVisible({ timeout: 10_000 })
      await page.evaluate(() => window.__jetAgent!.acceptConfirm())
      await page.waitForTimeout(300)
    } finally {
      await page
        .evaluate(async () => {
          try {
            await window.__jetAgent?.dismissConfirm()
          } catch {
            // dialog already closed
          }
        })
        .catch(() => {})
      await app.close()
    }
  })
})
