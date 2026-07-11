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

import { execCommand, launchJet } from "./_launch.js"

test.describe("electron output and tasks", () => {
  test("output.show reveals output panel", async () => {
    const { app, page } = await launchJet()
    try {
      await execCommand(page, "output.show")
      await expectSelectorVisible(page, '[data-jet-list-panel="output"]')
    } finally {
      await app.close()
    }
  })

  test("task.run shows message or output", async () => {
    const { app, page } = await launchJet()
    try {
      await execCommand(page, "task.run")
      await page.waitForTimeout(1500)
      const message = await page.evaluate(() => window.__jetAgent!.getState().message)
      const hasOutput = await page.locator('[data-jet-list-panel="output"]').isVisible().catch(() => false)
      const hasToast = await page.locator('[data-sonner-toast]').count().then(n => n > 0).catch(() => false)
      expect(message != null || hasOutput || hasToast).toBeTruthy()
    } finally {
      await app.close()
    }
  })
})
