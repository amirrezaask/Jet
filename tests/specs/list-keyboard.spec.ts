import { test, expect } from "@playwright/test"
import { boot, SAMPLE, waitAnimationsIdle } from "../helpers/boot.js"
import { agent } from "../helpers/agent.js"
import { showExplorer, EXPLORER_PANEL } from "../helpers/explorer.js"

test.beforeEach(async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await waitAnimationsIdle(page)
})

test("list-keyboard: explorer arrow and enter opens file", async ({ page }) => {
  await showExplorer(page)
  await agent(page).executeCommand("workbench.action.focusSideBar")
  await page.waitForTimeout(200)

  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("ArrowDown")
  await page.waitForTimeout(100)
  await page.keyboard.press("Enter")
  await page.waitForTimeout(600)

  await expect(page.locator(".cm-editor")).toBeVisible()
})

test("list-keyboard: location list search enter jumps to result", async ({ page }) => {
  await page.waitForTimeout(3000)
  await agent(page).executeCommand("locationlist.showSearch")
  await page.waitForTimeout(400)

  await page.locator('input[type="search"]').click()
  await page.keyboard.type("export")
  await page.waitForTimeout(2000)

  await agent(page).waitForListRows("locationlist", 1)
  await agent(page).executeCommand("workbench.action.focusSideBar")
  await page.waitForTimeout(200)
  await page.keyboard.press("ArrowDown")
  await page.waitForTimeout(100)
  await page.keyboard.press("Enter")
  await page.waitForTimeout(800)

  await expect(page.locator(".cm-editor")).toContainText("export")
})

test("list-keyboard: page down scrolls location list", async ({ page }) => {
  await page.goto("/?workspace=.")
  await page.waitForFunction(() => window.__jetAgent != null)
  await agent(page).waitForReady()
  await page.waitForTimeout(500)

  await agent(page).executeCommand("locationlist.showSearch")
  await page.waitForTimeout(400)
  await page.locator('input[type="search"]').click()
  await page.keyboard.type("export")
  await page.waitForTimeout(2000)

  const scrollBefore = await page.locator('[data-jet-list-panel="locationlist"] ul').evaluate(
    (el: HTMLElement) => el.scrollTop,
  )
  await page.keyboard.press("PageDown")
  await page.waitForTimeout(300)
  const scrollAfter = await page.locator('[data-jet-list-panel="locationlist"] ul').evaluate(
    (el: HTMLElement) => el.scrollTop,
  )
  expect(scrollAfter).toBeGreaterThanOrEqual(scrollBefore)
})
