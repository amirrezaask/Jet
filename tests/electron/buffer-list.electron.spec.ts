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
  expectLocatorContainsText,
  expectNotContainsText,
} from "../shell/assert.js"

import { execCommand, launchJet, openBufferList, openFixtureFile } from "./_launch.js"

test.describe("electron buffer list", () => {
  test("lists open buffers and switches active file", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/index.ts")
      await openFixtureFile(page, "src/utils.ts")

      await openBufferList(page)
      await expectLocatorContainsText(page.getByRole("dialog"), "index.ts")
      await expectLocatorContainsText(page.getByRole("dialog"), "utils.ts")

      await page.getByRole("option", { name: /index\.ts/i }).click()
      await page.evaluate(() => window.__jetAgent!.waitForEditor())
      await expectContainsText(page, ".cm-editor", "main()")
    } finally {
      await app.close()
    }
  })
})
