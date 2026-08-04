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

test.describe.skip("electron workspace open via agent", () => {
  test("openWorkspace updates active workspace path", async () => {
    const { app, page } = await launchJet()
    try {
      const alt = resolve(REPO_ROOT, "fixtures/second-workspace")
      await page.evaluate(async (p: string) => {
        await window.__yaadeAgent!.openWorkspace(p)
      }, alt)

      await expect
        .poll(() => page.evaluate(() => window.__yaadeAgent!.getState().activeWorkspace))
        .toContain("second-workspace")
    } finally {
      await app.close()
    }
  })
})
