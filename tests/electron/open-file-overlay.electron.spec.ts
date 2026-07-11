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

import { execCommand, launchJet, REPO_ROOT } from "./_launch.js"
import { resolve } from "node:path"

test.describe("electron open file overlay", () => {
  test("workspace.openFile opens path overlay and selects fixture file", async () => {
    const { app, page } = await launchJet()
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        await execCommand(page, "workspace.openFile")
        try {
          await page.getByRole("dialog").waitFor({ state: "visible", timeout: 3_000 })
          break
        } catch {
          if (attempt === 2) throw new Error("open-file overlay did not become visible")
        }
      }
      const input = page.getByRole("dialog").locator("input").first()
      await input.fill(resolve(REPO_ROOT, "fixtures/sample-workspace/src/utils.ts"))
      await page.getByRole("button", { name: /Open/ }).click()
      await page.evaluate(() => window.__jetAgent!.waitForEditor())
      await expect.poll(() => page.evaluate(() => window.__jetAgent!.getEditorText())).toContain("export function greet")
    } finally {
      await app.close()
    }
  })
})
