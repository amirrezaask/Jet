import { test, expect } from "@playwright/test"
import { boot, SAMPLE, waitAnimationsIdle } from "../helpers/boot.js"
import { agent } from "../helpers/agent.js"

test.beforeEach(async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await waitAnimationsIdle(page)
})

test("panel-layout: split editor creates two editor panels", async ({ page }) => {
  await agent(page).executeCommand("view.splitEditor")
  await page.waitForTimeout(500)

  const state = await agent(page).getState()
  const editors = state.panels.filter(p => p.kind === "editor")
  expect(editors.length).toBeGreaterThanOrEqual(2)
  await expect(page.locator(".cm-editor")).toHaveCount(2)
})

test("panel-layout: toggle editor layout changes orientation", async ({ page }) => {
  await agent(page).executeCommand("view.splitEditor")
  await page.waitForTimeout(400)

  const before = await page.evaluate(() => {
    const leaves = [...document.querySelectorAll<HTMLElement>("[data-jet-panel-leaf]")]
    if (leaves.length < 2) return null
    const a = leaves[0]!.getBoundingClientRect()
    const b = leaves[1]!.getBoundingClientRect()
    return { horizontal: Math.abs(a.top - b.top) < 8 }
  })
  expect(before).not.toBeNull()

  await page.keyboard.press("Meta+Alt+0")
  await page.waitForTimeout(400)

  const after = await page.evaluate(() => {
    const leaves = [...document.querySelectorAll<HTMLElement>("[data-jet-panel-leaf]")]
    if (leaves.length < 2) return null
    const a = leaves[0]!.getBoundingClientRect()
    const b = leaves[1]!.getBoundingClientRect()
    return { horizontal: Math.abs(a.top - b.top) < 8 }
  })
  expect(after).not.toBeNull()
  expect(after!.horizontal).not.toBe(before!.horizontal)
})

test("panel-layout: close location list panel removes it", async ({ page }) => {
  await agent(page).executeCommand("locationlist.show")
  await page.waitForTimeout(400)
  const before = await agent(page).getState()
  expect(before.panels.some(p => p.kind === "locationlist")).toBe(true)

  await page.locator('[data-tab-id="locationlist"] [aria-label="Close tab"]').click()
  await page.waitForTimeout(400)

  const after = await agent(page).getState()
  expect(after.panels.some(p => p.kind === "locationlist")).toBe(false)
})

test("panel-layout: focus last editor group", async ({ page }) => {
  await agent(page).executeCommand("view.splitEditor")
  await page.waitForTimeout(400)
  await page.keyboard.press("Meta+9")
  await page.waitForTimeout(200)

  const state = await agent(page).getState()
  expect(state.focusedPanel).not.toBeNull()
})
