import { test, expect } from "@playwright/test"
import { boot, REPO, waitAnimationsIdle } from "../helpers/boot.js"
import { agent } from "../helpers/agent.js"
import { showExplorer, EXPLORER_PANEL } from "../helpers/explorer.js"

test("explorer screenshot: jet repo panel rows must not overlap", async ({ page }) => {
  await boot(page, { workspace: REPO, file: "apps/jet-desktop/src/main/main.ts" })
  await showExplorer(page)

  const layout = await page.evaluate(() => {
    const items = [...document.querySelectorAll<HTMLElement>("[data-jet-list-panel='jet:explorer'] [data-jet-list-item]")]
    const tops = items.map(el => Math.round(el.getBoundingClientRect().top))
    const shrinks = items.slice(0, 5).map(el => getComputedStyle(el).flexShrink)
    return {
      count: items.length,
      uniqueTops: new Set(tops).size,
      minHeight: Math.min(...items.map(el => el.getBoundingClientRect().height)),
      shrinks,
    }
  })

  expect(layout.count).toBeGreaterThanOrEqual(10)
  expect(layout.uniqueTops).toBeGreaterThanOrEqual(10)
  expect(layout.minHeight).toBeGreaterThanOrEqual(18)
  expect(layout.shrinks.every(s => s === "0")).toBe(true)

  await expect(page.locator("[data-jet-list-panel='jet:explorer']")).toHaveScreenshot(
    "explorer-jet-repo-panel.png",
    { maxDiffPixelRatio: 0.02 },
  )
})

test("explorer screenshot: full window with explorer beside editor", async ({ page }) => {
  await boot(page, { workspace: REPO, file: "apps/jet-desktop/src/main/main.ts" })
  await showExplorer(page)

  await expect(page).toHaveScreenshot("explorer-jet-repo-window.png", {
    maxDiffPixelRatio: 0.02,
  })
})
