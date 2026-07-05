import type { Page } from "@playwright/test"
import { agent } from "./agent.js"

export const EXPLORER_PANEL = '[data-jet-list-panel="explorer"]'
export const EXPLORER_LEAF = `[data-jet-panel-leaf]:has(${EXPLORER_PANEL})`

export async function showExplorer(page: Page): Promise<void> {
  await agent(page).executeCommand("explorer.show")
  await page.waitForSelector(EXPLORER_PANEL, { timeout: 15_000 })
  await page.waitForTimeout(200)
}
