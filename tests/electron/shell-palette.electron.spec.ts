import { expect, test } from "@playwright/test"
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
      await expect(page.locator(EXPLORER_PANEL)).toBeVisible({ timeout: 10_000 })

      await execCommand(page, "ui.showCommandPalette")
      await page.keyboard.press("Escape")
      await expectPaletteClosed(page)
    } finally {
      await app.close()
    }
  })
})
