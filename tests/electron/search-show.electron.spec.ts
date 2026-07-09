import { expect, test } from "@playwright/test"
import { describeFlaky } from "./_flaky.js"
import { execCommand, launchJet, openFixtureFile, waitForSearchReady } from "./_launch.js"
import { SEARCH_LIST_PANEL, searchListItems } from "../helpers/location-list.js"
import { expectLayout } from "../helpers/list.js"

describeFlaky("electron search show", () => {
  test("search.show finds project hits and activates row", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/index.ts")
      await waitForSearchReady(page)
      await execCommand(page, "search.show")

      await page.locator('input[type="search"]').click()
      await page.keyboard.type("greet")
      await page.waitForTimeout(2500)

      const items = searchListItems()
      await expect(page.locator(SEARCH_LIST_PANEL)).not.toContainText("No results")
      await expectLayout(page, { selector: items, minItems: 1, minRowHeight: 18 })
      await expect(page.locator(SEARCH_LIST_PANEL)).toContainText("utils.ts")

      await page.locator(items).first().click()
      await page.waitForTimeout(500)
      await expect(page.locator(".cm-editor")).toContainText("export function greet")
    } finally {
      await app.close()
    }
  })
})
