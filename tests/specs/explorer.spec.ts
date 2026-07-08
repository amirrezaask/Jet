import { test, expect } from "@playwright/test"
import { boot, SAMPLE, REPO, waitAnimationsIdle } from "../helpers/boot.js"
import { agent } from "../helpers/agent.js"
import { EXPLORER_PANEL, EXPLORER_SIDEBAR, showExplorer } from "../helpers/explorer.js"
import {
  expectLayout,
  expectNoOverlap,
  expectNoClipping,
  expectRowTextVisible,
  expectElementWidth,
} from "../helpers/list.js"

test("explorer: shows files in sample workspace", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await waitAnimationsIdle(page)

  await showExplorer(page)

  await expect(page.locator(EXPLORER_PANEL)).toBeVisible()
  await expect(page.locator(EXPLORER_PANEL)).toContainText("src")
  await expect(page.locator(EXPLORER_PANEL)).toContainText("package.json")
  await expect(page.locator(EXPLORER_SIDEBAR)).toContainText("Files")

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

test("explorer: sidebar tabs switch between files and terminals", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await waitAnimationsIdle(page)

  await expect(page.getByRole("tab", { name: "Files" })).toHaveAttribute("data-state", "active")
  await expect(page.locator(EXPLORER_PANEL)).toBeVisible()

  await page.getByRole("tab", { name: "Terminals" }).click()
  await page.waitForTimeout(300)
  await expect(page.getByRole("tab", { name: "Terminals" })).toHaveAttribute("data-state", "active")
  await expect(page.locator('[data-jet-list-panel="jet:terminal-explorer"]')).toBeVisible()

  await page.getByRole("tab", { name: "Files" }).click()
  await page.waitForTimeout(300)
  await expect(page.getByRole("tab", { name: "Files" })).toHaveAttribute("data-state", "active")
  await expect(page.locator(EXPLORER_PANEL)).toBeVisible()
  await expectLayout(page, {
    selector: `${EXPLORER_PANEL} [data-jet-list-item]`,
    minItems: 3,
    minUniqueTops: 3,
    minRowHeight: 18,
  })
})

test("explorer: sidebar collapse leaves editor full width", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await waitAnimationsIdle(page)
  await showExplorer(page)

  await expectElementWidth(page, {
    selector: EXPLORER_SIDEBAR,
    minPctOfViewport: 12,
    maxPctOfViewport: 40,
  })

  await page.keyboard.press("Meta+b")
  await page.waitForTimeout(400)

  await expect(page.locator("[data-jet-workspace-sidebar]")).toHaveAttribute("data-sidebar-open", "false")
  await expectElementWidth(page, { selector: ".cm-editor", minPctOfViewport: 70 })

  await page.keyboard.press("Meta+b")
  await page.waitForTimeout(400)
  await expect(page.locator("[data-jet-workspace-sidebar]")).toHaveAttribute("data-sidebar-open", "true")
  await expect(page.locator(EXPLORER_PANEL)).toBeVisible()
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
