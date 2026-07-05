import { expect, test } from "@playwright/test"
import { launchJet, openFixtureFile } from "./_launch.js"
import {
  expectLayout,
  expectNoClipping,
  expectRowTextReadable,
  expectRowTextVisible,
} from "../helpers/list.js"

const PANEL_SEL = '[data-jet-list-panel="locationlist"]'
const ITEM_SEL = `${PANEL_SEL} [data-jet-list-item]`

test.describe("electron location list", () => {
  test("search result labels are readable", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/index.ts")
      await page.waitForTimeout(500)

      await page.evaluate(async () => {
        await window.__jetAgent!.executeCommand("locationlist.showSearch")
      })
      await page.waitForTimeout(400)

      await page.locator('input[type="search"]').click()
      await page.keyboard.type("main")
      await page.waitForTimeout(2500)

      await expect(page.locator(PANEL_SEL)).not.toContainText("No results")
      await expectLayout(page, { selector: ITEM_SEL, minItems: 1, minRowHeight: 22 })

      const firstRow = page.locator(ITEM_SEL).first()
      await expect(firstRow).toBeVisible()

      const label = firstRow.locator('[data-slot="row-label"]').first()
      await expect(label).not.toBeEmpty()
      await expect(label).toContainText(/main/i)

      const detail = firstRow.locator('[data-slot="row-detail"]').first()
      await expect(detail).toContainText(/:\d+:\d+/)
      await expect(page.locator(PANEL_SEL)).toContainText("src/")

      await expectRowTextReadable(page, { selector: ITEM_SEL, minItems: 1, minContrastRatio: 3 })
      await expectRowTextVisible(page, { selector: ITEM_SEL, minItems: 1, minGlyphHeightPx: 10 })
      await expectNoClipping(page, { selector: ITEM_SEL, containerSelector: PANEL_SEL })

      await firstRow.hover()
      await page.waitForTimeout(150)
      await expectRowTextReadable(page, { selector: ITEM_SEL, minItems: 1, minContrastRatio: 3 })

      await firstRow.focus()
      await page.waitForTimeout(150)
      await expectRowTextReadable(page, { selector: ITEM_SEL, minItems: 1, minContrastRatio: 3 })
      await expect(label).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test("jet repo search window in split layout — rows readable", async () => {
    const { app, page } = await launchJet(".")
    try {
      await page.evaluate(async () => {
        await window.__jetAgent!.executeCommand("view.splitEditor")
        await window.__jetAgent!.executeCommand("locationlist.showSearch")
      })
      await page.waitForTimeout(500)

      await page.locator('input[type="search"]').click()
      await page.keyboard.type("window")
      await page.waitForTimeout(3000)

      await expect(page.locator(PANEL_SEL)).not.toContainText("No results")
      await expectLayout(page, { selector: ITEM_SEL, minItems: 3, minRowHeight: 22 })
      await expect(page.locator(PANEL_SEL)).toContainText(":")
      await expectRowTextReadable(page, { selector: ITEM_SEL, minItems: 3, minContrastRatio: 3 })
      await expectRowTextVisible(page, { selector: ITEM_SEL, minItems: 3, minGlyphHeightPx: 10 })
    } finally {
      await app.close()
    }
  })

  test("problems tab rows are readable", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/lint-error.ts")
      await page.waitForTimeout(1500)

      await page.evaluate(async () => {
        await window.__jetAgent!.executeCommand("locationlist.showProblems")
      })
      await page.waitForTimeout(1500)

      await expect(page.locator(PANEL_SEL)).not.toContainText("No results")
      await expectLayout(page, { selector: ITEM_SEL, minItems: 1, minRowHeight: 22 })
      await expectRowTextReadable(page, { selector: ITEM_SEL, minItems: 1, minContrastRatio: 3 })
      await expectRowTextVisible(page, { selector: ITEM_SEL, minItems: 1, minGlyphHeightPx: 10 })
    } finally {
      await app.close()
    }
  })
})
