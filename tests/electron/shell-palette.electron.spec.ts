import { expect, test } from "@playwright/test"
import {
  expectContainsText,
  expectLocatorAttached,
  expectLocatorAttribute,
  expectLocatorCount,
  expectLocatorFocused,
  expectLocatorHidden,
  expectLocatorVisible,
  expectSelectorHidden,
  expectSelectorVisible,
} from "../shell/assert.js"

import { execCommand, launchJet } from "./_launch.js"
import { expectPaletteClosed, expectPaletteOpen } from "../helpers/shell.js"
import { EXPLORER_PANEL } from "../helpers/shell.js"

test.describe("electron shell palette", () => {
  test("opens centered, runs command, closes on Escape", async () => {
    const { app, page } = await launchJet()
    try {
      await execCommand(page, "ui.showCommandPalette")
      await expectPaletteOpen(page)
      await expect
        .poll(() => page.evaluate(() => window.__jetAgent!.getState().paletteOpen))
        .toBe(true)

      const input = page.getByRole("dialog").getByRole("combobox")
      await input.fill("explorer")
      await page.getByRole("option", { name: /explorer/i }).first().click()
      await expectSelectorVisible(page, EXPLORER_PANEL, { timeout: 10_000 })

      await execCommand(page, "ui.showCommandPalette")
      await page.keyboard.press("Escape")
      await expectPaletteClosed(page)
    } finally {
      await app.close()
    }
  })

  test("typing after keyboard navigation resets selection to the best match", async () => {
    const { app, page } = await launchJet()
    try {
      await execCommand(page, "ui.showCommandPalette")
      await expectPaletteOpen(page)
      const input = page.getByRole("dialog").getByRole("combobox")
      await input.fill("show")
      const selected = page.locator('[data-slot="command-item"][data-selected="true"]')
      await expectLocatorVisible(selected)
      const bestMatch = await selected.textContent()

      await page.keyboard.press("ArrowDown")
      await expect.poll(() => selected.textContent()).not.toBe(bestMatch)
      await page.keyboard.press(" ")
      await expect.poll(() => selected.textContent()).toBe(bestMatch)
    } finally {
      await app.close()
    }
  })
})
