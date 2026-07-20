import { expect, test } from "@playwright/test"
import {
  expectContainsText,
  expectLocatorAttached,
  expectLocatorAttribute,
  expectLocatorCount,
  expectLocatorFocused,
  expectLocatorHidden,
  expectLocatorVisible,
  expectSelectorHidden,
  expectSelectorVisible,
} from "../shell/assert.js"

import { execCommand, focusEditor, launchJet, openFixtureFile, typeInEditor } from "./_launch.js"

test.describe("electron dirty close confirm", () => {
  test("dismiss keeps buffer, accept closes", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/index.ts")
      await typeInEditor(page, "// dirty-marker")

      await expect
        .poll(() => page.evaluate(() => window.__gharargahAgent!.getState().activeEditorDirty), { timeout: 10_000 })
        .toBe(true)

      await execCommand(page, "workbench.action.focusFirstEditorGroup")
      await focusEditor(page)
      await page.evaluate(() => {
        void window.__gharargahAgent!.executeCommand("workspace.closeBuffer")
      })
      await expectSelectorVisible(page, '[data-gharargah-confirm="accept"]', { timeout: 10_000 })

      await page.evaluate(() => window.__gharargahAgent!.dismissConfirm())
      await expect
        .poll(() => page.evaluate(() => window.__gharargahAgent!.getState().openBuffers.length))
        .toBeGreaterThan(0)

      await focusEditor(page)
      await page.evaluate(() => {
        void window.__gharargahAgent!.executeCommand("workspace.closeBuffer")
      })
      await expectSelectorVisible(page, '[data-gharargah-confirm="accept"]', { timeout: 10_000 })
      await page.evaluate(() => window.__gharargahAgent!.acceptConfirm())
      await page.waitForTimeout(300)
    } finally {
      await page
        .evaluate(async () => {
          try {
            await window.__gharargahAgent?.dismissConfirm()
          } catch {
            // dialog already closed
          }
        })
        .catch(() => {})
      await app.close()
    }
  })
})
