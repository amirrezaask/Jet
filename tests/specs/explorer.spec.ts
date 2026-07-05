import { test, expect } from "@playwright/test"
import { boot, SAMPLE, REPO, waitAnimationsIdle } from "../helpers/boot.js"
import { agent } from "../helpers/agent.js"
import { EXPLORER_LEAF, EXPLORER_PANEL, showExplorer } from "../helpers/explorer.js"
import {
  expectLayout,
  expectNoOverlap,
  expectNoClipping,
  expectRowTextVisible,
  expectElementWidth,
  dragResizeHandle,
} from "../helpers/list.js"

test("explorer: shows files in sample workspace", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await waitAnimationsIdle(page)

  await showExplorer(page)

  await expect(page.locator(EXPLORER_PANEL)).toBeVisible()
  await expect(page.locator(EXPLORER_PANEL)).toContainText("src")
  await expect(page.locator(EXPLORER_PANEL)).toContainText("package.json")
  await expect(page.locator("[data-tab-id=\"explorer\"]")).toContainText("Explorer")

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
})

test("explorer: editor stays visible alongside explorer", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await waitAnimationsIdle(page)

  await showExplorer(page)
  await page.locator(`${EXPLORER_PANEL} [data-jet-list-item][aria-label="src"]`).click()
  await page.waitForTimeout(500)

  await expect(page.locator(EXPLORER_PANEL)).toContainText("index.ts")
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
  await expectElementWidth(page, { selector: ".cm-editor", minPctOfViewport: 40 })

  const state = await agent(page).getState()
  expect(state.paletteOpen).toBe(false)

  await page.keyboard.press("Meta+Shift+E")
  await page.waitForTimeout(300)
  await expect(page.locator(EXPLORER_PANEL)).toBeVisible()
})

test("explorer: jet repo layout — no overlapping rows", async ({ page }) => {
  await boot(page, { workspace: REPO })
  await page.waitForTimeout(500)
  await showExplorer(page)

  await expect(page.locator(EXPLORER_PANEL)).toContainText("packages")
  await expectLayout(page, {
    selector: `${EXPLORER_PANEL} [data-jet-list-item]`,
    minItems: 10,
    minUniqueTops: 10,
    minRowHeight: 18,
  })
  await expectNoOverlap(page, {
    selector: `${EXPLORER_PANEL} [data-jet-list-item]`,
    minItems: 10,
  })
  await expectRowTextVisible(page, {
    selector: `${EXPLORER_PANEL} [data-jet-list-item]`,
    minItems: 10,
  })
})

test("explorer: deep expand — no overlap in nested tree", async ({ page }) => {
  await boot(page, { workspace: REPO })
  await page.waitForTimeout(500)
  await showExplorer(page)

  await page.locator(`${EXPLORER_PANEL} [data-jet-list-item][aria-label="packages"]`).click()
  await page.waitForTimeout(500)
  await page.locator(`${EXPLORER_PANEL} [data-jet-list-item][aria-label="jet-ui"]`).click()
  await page.waitForTimeout(500)
  await page.locator(`${EXPLORER_PANEL} [data-jet-list-item][aria-label="src"]`).click()
  await page.waitForTimeout(500)

  await expectNoOverlap(page, {
    selector: `${EXPLORER_PANEL} [data-jet-list-item]`,
    minItems: 15,
  })
  await expectLayout(page, {
    selector: `${EXPLORER_PANEL} [data-jet-list-item]`,
    minItems: 15,
    minUniqueTops: 15,
    minRowHeight: 18,
  })
  await expectRowTextVisible(page, {
    selector: `${EXPLORER_PANEL} [data-jet-list-item]`,
    minItems: 15,
  })
})

test("explorer: narrow viewport — no clipping", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 })
  await boot(page, { workspace: REPO })
  await page.waitForTimeout(500)
  await showExplorer(page)

  await page.locator(`${EXPLORER_PANEL} [data-jet-list-item][aria-label="packages"]`).click()
  await page.waitForTimeout(500)
  await page.locator(`${EXPLORER_PANEL} [data-jet-list-item][aria-label="jet-ui"]`).click()
  await page.waitForTimeout(500)
  await page.locator(`${EXPLORER_PANEL} [data-jet-list-item][aria-label="src"]`).click()
  await page.waitForTimeout(500)
  await page.locator(`${EXPLORER_PANEL} [data-jet-list-item][aria-label="tabs"]`).click()
  await page.waitForTimeout(500)

  await expectNoOverlap(page, {
    selector: `${EXPLORER_PANEL} [data-jet-list-item]`,
    minItems: 10,
  })
  await expectNoClipping(page, {
    selector: `${EXPLORER_PANEL} [data-jet-list-item]`,
    containerSelector: EXPLORER_PANEL,
  })
  await expectRowTextVisible(page, {
    selector: `${EXPLORER_PANEL} [data-jet-list-item]`,
    minItems: 10,
  })
})

test("explorer: resize handle changes width", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await waitAnimationsIdle(page)
  await showExplorer(page)

  await expectElementWidth(page, {
    selector: EXPLORER_LEAF,
    minPctOfViewport: 18,
    maxPctOfViewport: 30,
  })

  await dragResizeHandle(page, { deltaX: 140 })
  await page.waitForTimeout(300)

  await expectElementWidth(page, { selector: EXPLORER_LEAF, minPctOfViewport: 28 })
  await showExplorer(page)
  await expect(page.locator(EXPLORER_PANEL)).toBeVisible()
  await expectElementWidth(page, { selector: EXPLORER_LEAF, minPctOfViewport: 28 })
})

test("explorer: opening file loads it in editor", async ({ page }) => {
  await boot(page, { workspace: SAMPLE })
  await page.waitForTimeout(500)
  await showExplorer(page)

  await page.locator(`${EXPLORER_PANEL} [data-jet-list-item][aria-label="src"]`).click()
  await page.waitForTimeout(400)
  await page.locator(`${EXPLORER_PANEL} [data-jet-list-item][aria-label="utils.ts"]`).click()
  await page.waitForTimeout(800)

  await expect(page.locator(".cm-editor")).toContainText("export function greet")
  await expectElementWidth(page, { selector: ".cm-editor", minPctOfViewport: 40 })
})
