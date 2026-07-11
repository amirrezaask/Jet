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

import { execCommand, launchJet } from "./_launch.js"

test.describe("electron switch project", () => {
  test("opens project switcher overlay", async () => {
    const { app, page } = await launchJet()
    try {
      await execCommand(page, "workspace.switchProject")
      await expectLocatorVisible(page.getByRole("dialog"))
      await expectLocatorVisible(page.locator('input[placeholder="Filter projects…"]'))
    } finally {
      await app.close()
    }
  })
})
