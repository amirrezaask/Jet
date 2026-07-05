import type { Page } from "@playwright/test"
import { expect } from "@playwright/test"
import { agent } from "./agent.js"

export async function expectOverlayOpen(page: Page, text: string): Promise<void> {
  await expect(page.locator('[role="dialog"]')).toBeVisible()
  await expect(page.locator("body")).toContainText(text)
}

export async function confirmDialog(page: Page, action: "confirm" | "cancel"): Promise<void> {
  const sel = action === "confirm" ? '[data-jet-confirm="accept"]' : '[data-jet-confirm="cancel"]'
  await page.locator(sel).click()
  await page.waitForTimeout(100)
}

export async function selectPaletteItem(page: Page, needle: string): Promise<void> {
  await page.keyboard.type(needle)
  await page.waitForTimeout(200)
  await expect(page.locator("body")).toContainText(needle)
  await page.keyboard.press("Enter")
  await page.waitForTimeout(300)
}
