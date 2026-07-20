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

import { launchJet, REPO_ROOT } from "./_launch.js"
import { resolve } from "node:path"

const SECOND = resolve(REPO_ROOT, "fixtures/second-workspace")

test.describe("electron multi-root workspace", () => {
  test("addWorkspace, focusFolder, removeFolder", async () => {
    const { app, page } = await launchJet()
    try {
      await page.evaluate(async (p: string) => {
        await window.__gharargahAgent!.addWorkspace(p)
      }, SECOND)

      await expect
        .poll(() => page.evaluate(() => window.__gharargahAgent!.listWorkspaces().length))
        .toBe(2)

      await page.evaluate(async () => {
        await window.__gharargahAgent!.executeCommand("workspace.focusFolder")
      })
      await page.waitForTimeout(300)

      await page.evaluate(async () => {
        await window.__gharargahAgent!.executeCommand("workspace.removeFolder")
      })
      await page.waitForTimeout(300)
    } finally {
      await app.close()
    }
  })
})
