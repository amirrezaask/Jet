import { expect, test } from "@playwright/test"
import {
  expectContainsText,
  expectSelectorVisible,
  expectNotContainsText,
} from "../shell/assert.js"

import { execCommand, launchJet, openFixtureFile, waitForSearchReady } from "./_launch.js"
import { SEARCH_LIST_PANEL, searchListItems } from "../helpers/location-list.js"
import { expectLayout } from "../helpers/list.js"

test.describe("electron search show", () => {
  test("search.show finds project hits and activates row", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/index.ts")
      await waitForSearchReady(page)
      await execCommand(page, "search.show")

      await expectSelectorVisible(
        page,
        `${SEARCH_LIST_PANEL} [data-gharargah-lister] [data-slot="command-input"]`,
      )

      await page.locator('input[type="search"]').click()
      await page.keyboard.type("greet")
      await page.waitForTimeout(2500)

      const items = searchListItems()
      await expectNotContainsText(page, SEARCH_LIST_PANEL, "No results")
      await expectLayout(page, { selector: items, minItems: 1, minRowHeight: 18 })
      await expectContainsText(page, SEARCH_LIST_PANEL, "utils.ts")

      const filterInput = page.locator(
        `${SEARCH_LIST_PANEL} [data-gharargah-lister] [data-slot="command-input"]`,
      )
      await filterInput.fill("utils")
      await expectLayout(page, { selector: items, minItems: 1, minRowHeight: 18 })
      await expectContainsText(page, SEARCH_LIST_PANEL, "utils.ts")

      await page.locator(items).filter({ hasText: "utils.ts" }).first().click()
      await page.waitForTimeout(500)
      await expect.poll(() => page.evaluate(() => window.__gharargahAgent!.getEditorText())).toContain("export function greet")
    } finally {
      await app.close()
    }
  })
})

