import { expect, test } from "@playwright/test"
import {
  expectLocatorContainsText,
  expectLocatorCount,
  expectLocatorVisible,
  expectSelectorVisible,
} from "../shell/assert.js"

import { resolve } from "node:path"
import { launchJet, REPO_ROOT } from "./_launch.js"

test.describe("electron project persistence", () => {
  test("restores saved projects on home after reload", async () => {
    const secondPath = resolve(REPO_ROOT, "fixtures/second-workspace")

    const { app, page } = await launchJet()
    try {
      await page.evaluate(path => window.__gharargahAgent!.addWorkspace(path), secondPath)
      await expect
        .poll(() => page.evaluate(() => window.__gharargahAgent!.listWorkspaces().length))
        .toBe(2)

      const secondName = "second-workspace"
      const section = page.locator(
        `[data-gharargah-project-section][data-gharargah-project-name="${secondName}"]`,
      )
      await expectLocatorVisible(section)
      await section.getByRole("button", { name: "New session" }).click()
      await page
        .locator('[data-slot="dropdown-menu-content"] [data-slot="dropdown-menu-item"]', {
          hasText: "Blank session",
        })
        .click()
      await expectSelectorVisible(page, "[data-gharargah-terminal-modal]", { timeout: 20_000 })
      await page.keyboard.press("Escape")
      await expectLocatorCount(page.locator("[data-gharargah-terminal-modal]"), 0)

      await page.reload()
      await page.waitForFunction(() => window.__gharargahAgent != null, null, { timeout: 30_000 })
      await page.evaluate(() => window.__gharargahAgent!.waitForReady())
      await expect
        .poll(() => page.evaluate(() => window.__gharargahAgent!.listWorkspaces().length))
        .toBe(2)

      await expectSelectorVisible(page, "[data-gharargah-home]")
      const home = page.locator("[data-gharargah-home]")
      await expectLocatorContainsText(home, "sample-workspace")
      await expectLocatorContainsText(home, "second-workspace")
      await expectLocatorCount(page.locator(".cm-editor"), 0)
      await expectLocatorCount(page.locator("[data-gharargah-workspace-sidebar]"), 0)
    } finally {
      await app.close()
    }
  })
})
