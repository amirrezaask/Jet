import type { Page } from "@playwright/test"
import { expect } from "@playwright/test"

export async function expectPaletteOpen(page: Page): Promise<void> {
  await expect(page.getByRole("dialog")).toBeVisible()
  await expect(page.getByPlaceholder(/filter|search|command/i)).toBeVisible()
}

export async function expectPaletteClosed(page: Page): Promise<void> {
  await expect(page.getByRole("dialog")).toHaveCount(0)
}

export const EXPLORER_PANEL = '[data-jet-list-panel="jet:explorer"]'
