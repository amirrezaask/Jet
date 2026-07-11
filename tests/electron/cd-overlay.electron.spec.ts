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

import { confirmOverlay, execCommand, launchJet, REPO_ROOT, waitForDialog } from "./_launch.js"

test.describe("electron cd overlay", () => {
  test("workspace.cd switches active workspace path", async () => {
    const { app, page } = await launchJet(".")
    try {
      const target = `${REPO_ROOT}/fixtures/sample-workspace`
      await execCommand(page, "workspace.cd")
      await waitForDialog(page)
      await expectLocatorVisible(page.getByRole("dialog"))
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
