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

import { execCommand, launchJet, openFixtureFile, waitForLspConnected, waitForSearchReady } from "./_launch.js"
import {
  expectLayout,
  expectNoClipping,
  expectRowTextReadable,
  expectRowTextVisible,
} from "../helpers/list.js"

import {
  PROBLEMS_PANEL,
  SEARCH_LIST_PANEL,
  searchListItems,
  problemsListItems,
} from "../helpers/location-list.js"

const ITEM_SEL = searchListItems()

test.describe("electron location list", () => {
  test("search result labels are readable", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/index.ts")
      await waitForSearchReady(page)

      await page.evaluate(async () => {
        await window.__jetAgent!.executeCommand("locationlist.showSearch")
      })
      await page.waitForTimeout(400)

      await page.locator('input[type="search"]').click()
      await page.keyboard.type("main")
      await expect
        .poll(async () => page.locator(ITEM_SEL).count(), { timeout: 30_000 })
        .toBeGreaterThan(0)

      await expectNotContainsText(page, SEARCH_LIST_PANEL, "No results")
      await expectLayout(page, { selector: ITEM_SEL, minItems: 1, minRowHeight: 22 })

      const firstRow = page.locator(ITEM_SEL).first()
      await expectLocatorVisible(firstRow)

      const label = firstRow.locator('[data-slot="row-label"]').first()
      await expect.poll(() => label.evaluate(el => (el.textContent ?? "").trim().length)).toBeGreaterThan(0)
      await expectLocatorContainsText(label, /main/i)

      const detail = firstRow.locator('[data-slot="row-detail"]').first()
      await expectLocatorContainsText(detail, /:\d+:\d+/)
      await expectContainsText(page, SEARCH_LIST_PANEL, "src/")

      await expectRowTextReadable(page, { selector: ITEM_SEL, minItems: 1, minContrastRatio: 2.5 })
      await expectRowTextVisible(page, { selector: ITEM_SEL, minItems: 1, minGlyphHeightPx: 10 })
      await expectNoClipping(page, { selector: ITEM_SEL, containerSelector: SEARCH_LIST_PANEL })

      await firstRow.hover()
      await page.waitForTimeout(150)
      await expectRowTextVisible(page, { selector: ITEM_SEL, minItems: 1, minGlyphHeightPx: 10 })

      await firstRow.focus()
      await page.waitForTimeout(150)
      await expectRowTextVisible(page, { selector: ITEM_SEL, minItems: 1, minGlyphHeightPx: 10 })
      await expectLocatorVisible(label)
    } finally {
      await app.close()
    }
  })

  test("split layout search rows are readable", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/index.ts")
      await waitForSearchReady(page)
      await execCommand(page, "view.splitEditor")
      await execCommand(page, "locationlist.showSearch")
      await expectSelectorVisible(page, 'input[type="search"]', { timeout: 10_000 })

      await page.locator('input[type="search"]').click()
      await page.keyboard.type("greet")
      await expect
        .poll(async () => page.locator(ITEM_SEL).count(), { timeout: 30_000 })
        .toBeGreaterThan(0)

      await expectNotContainsText(page, SEARCH_LIST_PANEL, "No results")
      await expectLayout(page, { selector: ITEM_SEL, minItems: 1, minRowHeight: 22 })
      await expectContainsText(page, SEARCH_LIST_PANEL, "utils.ts")
      await expectRowTextVisible(page, { selector: ITEM_SEL, minItems: 1, minGlyphHeightPx: 10 })
    } finally {
      await app.close()
    }
  })

  test("problems tab rows are readable", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/lint-error.ts")
      await waitForLspConnected(page)
      await page.waitForTimeout(2000)

      await page.evaluate(async () => {
        await window.__jetAgent!.executeCommand("locationlist.showProblems")
      })

      const problemsSel = problemsListItems()
      await expect
        .poll(async () => page.locator(problemsSel).count(), { timeout: 30_000 })
        .toBeGreaterThan(0)

      await expectNotContainsText(page, PROBLEMS_PANEL, "No results")
      await expectContainsText(page, PROBLEMS_PANEL, /error|Type|problem/i)
      await expectLayout(page, { selector: problemsListItems(), minItems: 1, minRowHeight: 22 })
      await expectRowTextReadable(page, { selector: problemsListItems(), minItems: 1, minContrastRatio: 3 })
      await expectRowTextVisible(page, { selector: problemsListItems(), minItems: 1, minGlyphHeightPx: 10 })
    } finally {
      await app.close()
    }
  })
})
