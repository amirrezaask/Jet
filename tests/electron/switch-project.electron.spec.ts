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

import { describeFlaky } from "./_flaky.js"
import { execCommand, launchJet } from "./_launch.js"

describeFlaky("electron switch project", () => {
  test("opens project switcher overlay", async () => {
    const { app, page } = await launchJet()
    try {
      await execCommand(page, "workspace.switchProject")
      await expectLocatorVisible(page.getByRole("dialog"))
      await expectLocatorContainsText(page.getByRole("dialog"), /project/i)
    } finally {
      await app.close()
    }
  })
})
