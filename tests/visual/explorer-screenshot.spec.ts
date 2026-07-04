import { test, expect } from "@playwright/test"

async function openJetRepoWithExplorer(page: import("@playwright/test").Page) {
  await page.goto("/?workspace=.&file=apps/jet-desktop/src/main/main.ts")
  await page.waitForFunction(() => window.__jetAgent != null)
  await page.evaluate(async () => {
    await window.__jetAgent!.waitForReady()
    await window.__jetAgent!.waitForEditor()
    await window.__jetAgent!.executeCommand("explorer.show")
  })
  await page.waitForSelector("[data-jet-list-panel='explorer'] [data-jet-list-item]", {
    timeout: 15_000,
  })
  await page.waitForTimeout(400)
}

test("explorer panel screenshot — rows must not overlap", async ({ page }) => {
  await openJetRepoWithExplorer(page)

  const layout = await page.evaluate(() => {
    const items = [...document.querySelectorAll<HTMLElement>("[data-jet-list-item]")]
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

  await expect(page.locator("[data-jet-list-panel='explorer']")).toHaveScreenshot(
    "explorer-jet-repo-panel.png",
    { maxDiffPixelRatio: 0.02 },
  )
})

test("full window screenshot — explorer beside editor", async ({ page }) => {
  await openJetRepoWithExplorer(page)
  await expect(page).toHaveScreenshot("explorer-jet-repo-window.png", {
    maxDiffPixelRatio: 0.02,
  })
})

declare global {
  interface Window {
    __jetAgent?: {
      waitForReady(): Promise<void>
      waitForEditor(timeoutMs?: number): Promise<void>
      executeCommand(id: string): Promise<void>
    }
  }
}
