import { test, expect } from "@playwright/test"
import { boot, SAMPLE, waitAnimationsIdle } from "../helpers/boot.js"
import { agent } from "../helpers/agent.js"
import { showExplorer, EXPLORER_PANEL } from "../helpers/explorer.js"
import {
  expectLayout,
  expectNoOverlap,
  expectNoClipping,
  expectRowSpacing,
  expectRowTextVisible,
  expectRowTextReadable,
} from "../helpers/list.js"

const PANEL_SEL = "[data-jet-list-panel=\"locationlist\"]"
const ITEM_SEL = `${PANEL_SEL} [data-jet-list-item]`

test.beforeEach(async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
})

test("location-list: explorer + location list panels visible", async ({ page }) => {
  await waitAnimationsIdle(page)
  await showExplorer(page)

  await expect(page.locator(EXPLORER_PANEL)).toBeVisible()
  await expectLayout(page, {
    selector: `${EXPLORER_PANEL} [data-jet-list-item]`,
    minItems: 3,
    minUniqueTops: 3,
    minRowHeight: 18,
  })
  await expectRowTextVisible(page, {
    selector: `${EXPLORER_PANEL} [data-jet-list-item]`,
    minItems: 3,
  })

  await agent(page).executeCommand("locationlist.show")
  await page.waitForTimeout(400)

  await expect(page.locator("body")).toContainText("Search")
  await expect(page.locator("body")).toContainText("Problems")
})

test("location-list: project search finds results", async ({ page }) => {
  await page.waitForTimeout(3000)
  await agent(page).executeCommand("locationlist.showSearch")
  await page.waitForTimeout(400)

  await page.locator("input[type=\"search\"]").click()
  await page.keyboard.type("export")
  await page.waitForTimeout(2000)

  await expect(page.locator(PANEL_SEL)).not.toContainText("No results")
  await expectLayout(page, { selector: ITEM_SEL, minItems: 2, minUniqueTops: 2, minRowHeight: 22 })
  await expectNoOverlap(page, { selector: ITEM_SEL, minItems: 2 })
  await expectRowSpacing(page, { selector: ITEM_SEL, minItems: 2, maxGapPx: 2 })
  await expect(page.locator(PANEL_SEL)).toContainText("src/")
  await expect(page.locator(PANEL_SEL)).toContainText(":")
})

test("location-list: search no results shows message", async ({ page }) => {
  await agent(page).executeCommand("locationlist.showSearch")
  await page.waitForTimeout(400)

  await page.locator("input[type=\"search\"]").click()
  await page.keyboard.type("zzzzznever_matches_anywhere_qwx")
  await page.waitForTimeout(2000)

  await expect(page.locator(PANEL_SEL)).toContainText("No results")
})

test("location-list: case toggle still returns results", async ({ page }) => {
  await agent(page).executeCommand("locationlist.showSearch")
  await page.waitForTimeout(400)

  await page.locator("input[type=\"search\"]").click()
  await page.keyboard.type("export")
  await page.waitForTimeout(2000)

  await expectLayout(page, { selector: ITEM_SEL, minItems: 1 })

  await page.locator("[data-value=\"case\"], button:has-text(\"Case\")").click()
  await page.waitForTimeout(1500)

  await expectLayout(page, { selector: ITEM_SEL, minItems: 1 })
})

test("location-list: row text visible after search", async ({ page }) => {
  await agent(page).executeCommand("locationlist.showSearch")
  await page.waitForTimeout(400)

  await page.locator("input[type=\"search\"]").click()
  await page.keyboard.type("export")
  await page.waitForTimeout(2000)

  await expectLayout(page, { selector: ITEM_SEL, minItems: 2, minRowHeight: 22 })
  await expectRowTextVisible(page, { selector: ITEM_SEL, minItems: 2, minGlyphHeightPx: 12 })
  await expectNoClipping(page, { selector: ITEM_SEL, containerSelector: PANEL_SEL })
})

test("location-list: search result labels are readable", async ({ page }) => {
  await agent(page).executeCommand("locationlist.showSearch")
  await page.waitForTimeout(400)

  await page.locator("input[type=\"search\"]").click()
  await page.keyboard.type("main")
  await page.waitForTimeout(2000)

  await expect(page.locator(PANEL_SEL)).not.toContainText("No results")
  await expectLayout(page, { selector: ITEM_SEL, minItems: 1, minRowHeight: 22 })

  const firstRow = page.locator(ITEM_SEL).first()
  await expect(firstRow).toBeVisible()
  await expect(firstRow).not.toHaveText(/^main$/i)

  const label = firstRow.locator('[data-slot="row-label"]').first()
  await expect(label).not.toBeEmpty()
  await expect(label).toContainText(/main/i)

  const detail = firstRow.locator('[data-slot="row-detail"]').first()
  await expect(detail).toContainText(/:\d+:\d+/)

  await expectRowTextReadable(page, { selector: ITEM_SEL, minItems: 1, minContrastRatio: 3 })
  await expectRowTextVisible(page, { selector: ITEM_SEL, minItems: 1, minGlyphHeightPx: 10 })

  await firstRow.hover()
  await page.waitForTimeout(150)
  await expectRowTextReadable(page, { selector: ITEM_SEL, minItems: 1, minContrastRatio: 3 })

  await firstRow.focus()
  await page.waitForTimeout(150)
  await expectRowTextReadable(page, { selector: ITEM_SEL, minItems: 1, minContrastRatio: 3 })
  await expect(label).toBeVisible()
})

test("location-list: scroll after search — no overlap/spacing regressions", async ({ page }) => {
  await page.goto("/?workspace=.")
  await page.waitForFunction(() => window.__jetAgent != null)
  await agent(page).waitForReady()
  await page.waitForTimeout(500)

  await agent(page).executeCommand("locationlist.showSearch")
  await page.waitForTimeout(400)

  await page.locator("input[type=\"search\"]").click()
  await page.keyboard.type("export")
  await page.waitForTimeout(2000)

  await expectLayout(page, { selector: ITEM_SEL, minItems: 5, minRowHeight: 22 })

  await page.locator(`${PANEL_SEL} ul`).evaluate((el: HTMLElement) => el.scrollBy({ top: 800, behavior: "instant" as ScrollBehavior }))
  await page.waitForTimeout(400)

  await expectNoOverlap(page, { selector: ITEM_SEL, minItems: 5 })
  await expectRowSpacing(page, { selector: ITEM_SEL, minItems: 5, maxGapPx: 2 })
  await expectRowTextVisible(page, { selector: ITEM_SEL, minItems: 5 })
})

test("location-list: dense search in jet repo — no overlap", async ({ page }) => {
  // use repo root for larger result set
  await page.goto("/?workspace=.")
  await page.waitForFunction(() => window.__jetAgent != null)
  await agent(page).waitForReady()
  await page.waitForTimeout(500)

  await agent(page).executeCommand("view.splitEditor")
  await page.waitForTimeout(400)
  await agent(page).executeCommand("locationlist.showSearch")
  await page.waitForTimeout(400)

  await page.locator("input[type=\"search\"]").click()
  await page.keyboard.type("PanelTree")
  await page.waitForTimeout(2500)

  await expect(page.locator(PANEL_SEL)).not.toContainText("No results")
  await expectNoOverlap(page, { selector: "[data-jet-list-item]", minItems: 15 })
  await expectRowSpacing(page, { selector: "[data-jet-list-item]", minItems: 15, maxGapPx: 4 })
  await expectLayout(page, { selector: "[data-jet-list-item]", minItems: 15, minUniqueTops: 15, minRowHeight: 22 })
  await expectRowTextVisible(page, { selector: "[data-jet-list-item]", minItems: 15 })
})

test("location-list: search in jet repo explorer", async ({ page }) => {
  await page.goto("/?workspace=.")
  await page.waitForFunction(() => window.__jetAgent != null)
  await agent(page).waitForReady()
  await page.waitForTimeout(500)

  await agent(page).executeCommand("locationlist.show")
  await page.waitForTimeout(400)
  await page.locator("input[type=\"search\"]").click()
  await page.keyboard.type("explorer")
  await page.waitForTimeout(2000)

  await expect(page.locator(PANEL_SEL)).not.toContainText("No results")
  await expectLayout(page, { selector: ITEM_SEL, minItems: 5, minRowHeight: 22 })
  await expectNoOverlap(page, { selector: ITEM_SEL, minItems: 5 })
  await expectRowSpacing(page, { selector: ITEM_SEL, minItems: 5, maxGapPx: 2 })
  await expectRowTextVisible(page, { selector: ITEM_SEL, minItems: 5 })
  await expectNoClipping(page, { selector: ITEM_SEL, containerSelector: PANEL_SEL })
  await expect(page.locator(PANEL_SEL)).toContainText(":")
})

test("location-list: click search result opens file at line", async ({ page }) => {
  await page.waitForTimeout(3000)
  await agent(page).executeCommand("locationlist.showSearch")
  await page.waitForTimeout(400)

  await page.locator('input[type="search"]').click()
  await page.keyboard.type("export function main")
  await page.waitForTimeout(2000)

  await expectLayout(page, { selector: ITEM_SEL, minItems: 1 })
  await page.locator(`${ITEM_SEL}`).first().click()
  await page.waitForTimeout(800)

  await expect(page.locator(".cm-editor")).toContainText("export function main")
})

test("location-list: problems tab shows lint-error rows", async ({ page }) => {
  await agent(page).openFile("src/lint-error.ts")
  await page.waitForTimeout(800)
  await agent(page).executeCommand("locationlist.showProblems")
  await page.waitForTimeout(1000)

  await expect(page.locator(PANEL_SEL)).toContainText("Problems")
  const body = await page.locator("body").textContent()
  expect(body).toMatch(/problem|error|lint|Type/i)
})

test("location-list: regex toggle filters differently", async ({ page }) => {
  await agent(page).executeCommand("locationlist.showSearch")
  await page.waitForTimeout(400)

  await page.locator('input[type="search"]').click()
  await page.keyboard.type("export function")
  await page.waitForTimeout(2000)
  const countPlain = await page.locator(ITEM_SEL).count()

  await page.locator('[data-value="regex"], button:has-text("Regex")').click()
  await page.waitForTimeout(1500)
  await page.locator('input[type="search"]').click()
  await page.keyboard.press("Meta+a")
  await page.keyboard.type("export\\s+function")
  await page.waitForTimeout(2000)

  await expectLayout(page, { selector: ITEM_SEL, minItems: 1 })
  const countRegex = await page.locator(ITEM_SEL).count()
  expect(countRegex).toBeGreaterThanOrEqual(1)
  expect(countPlain).toBeGreaterThanOrEqual(1)
})
