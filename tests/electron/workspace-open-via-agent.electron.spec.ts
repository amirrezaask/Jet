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

test.describe("electron workspace open via agent", () => {
  test("openWorkspace updates active workspace path", async () => {
    const { app, page } = await launchJet()
    try {
      const alt = resolve(REPO_ROOT, "fixtures/second-workspace")
      await page.evaluate(async (p: string) => {
        await window.__jetAgent!.openWorkspace(p)
      }, alt)

      await expect
        .poll(() => page.evaluate(() => window.__jetAgent!.getState().activeWorkspace))
        .toContain("second-workspace")
    } finally {
      await app.close()
    }
  })
})
