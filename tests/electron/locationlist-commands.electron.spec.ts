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

import { describeFlaky } from "./_flaky.js"
import { execCommand, launchJet, openFixtureFile, waitForSearchReady } from "./_launch.js"
import { PROBLEMS_PANEL, SEARCH_LIST_PANEL } from "../helpers/location-list.js"

describeFlaky("electron location list commands", () => {
  test("locationlist.show opens unified panel", async () => {
    const { app, page } = await launchJet()
    try {
      await waitForSearchReady(page)
      await execCommand(page, "locationlist.showSearch")
      await expectSelectorVisible(page, 'input[type="search"]', { timeout: 15_000 })
      await expectSelectorVisible(page, SEARCH_LIST_PANEL)
    } finally {
      await app.close()
    }
  })

  test("showSearch and showProblems switch feeds", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/lint-error.ts")
      await page.waitForTimeout(1500)

      await execCommand(page, "locationlist.showSearch")
      await expectSelectorVisible(page, 'input[type="search"]')

      await execCommand(page, "locationlist.showProblems")
      await page.waitForTimeout(1000)
      await expectSelectorVisible(page, PROBLEMS_PANEL)
    } finally {
      await app.close()
    }
  })
})
