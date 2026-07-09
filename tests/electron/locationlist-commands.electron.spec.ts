import { expect, test } from "@playwright/test"
import { execCommand, launchJet, openFixtureFile, waitForSearchReady } from "./_launch.js"
import { PROBLEMS_PANEL, SEARCH_LIST_PANEL } from "../helpers/location-list.js"

test.describe("electron location list commands", () => {
  test("locationlist.show opens unified panel", async () => {
    const { app, page } = await launchJet()
    try {
      await waitForSearchReady(page)
      await execCommand(page, "locationlist.showSearch")
      await expect(page.locator('input[type="search"]')).toBeVisible({ timeout: 15_000 })
      await expect(page.locator(SEARCH_LIST_PANEL)).toBeVisible()
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
      await expect(page.locator('input[type="search"]')).toBeVisible()

      await execCommand(page, "locationlist.showProblems")
      await page.waitForTimeout(1000)
      await expect(page.locator(PROBLEMS_PANEL)).toBeVisible()
    } finally {
      await app.close()
    }
  })
})
