import { expect, test } from "@playwright/test"
import {
  expectListRows,
  expectRowActionAlignment,
  expectRowTextVisible,
} from "../helpers/list.js"
import { expectLocatorVisible, expectSelectorVisible } from "../shell/assert.js"
import { execCommand, launchJet, waitForHome } from "./_launch.js"

const paletteRows =
  '[data-yaade-list-panel="yaade:palette"] [data-yaade-list-item]'

test.describe("command palette row layout", () => {
  test("keeps title, metadata, badges, and keybindings aligned across UI font scales", async () => {
    const { app, page } = await launchJet()
    try {
      await waitForHome(page)

      for (let step = 0; step < 2; step += 1) {
        await execCommand(page, "ui.zoomOut")
      }
      await execCommand(page, "ui.showCommandPalette")
      await expectSelectorVisible(page, "[data-yaade-palette]")
      await expectListRows(page, {
        panel: "yaade:palette",
        minItems: 3,
        minRowHeight: 25,
        noResultsText: "No results.",
      })
      await expectRowTextVisible(page, {
        selector: paletteRows,
        minItems: 3,
        textSelector: '[data-slot="palette-row-title"]',
      })
      await expectRowActionAlignment(page, {
        selector: paletteRows,
        minItems: 2,
      })
      await page.keyboard.press("Escape")

      for (let step = 0; step < 7; step += 1) {
        await execCommand(page, "ui.zoomIn")
      }
      await execCommand(page, "ui.showCommandPalette")
      await expectSelectorVisible(page, "[data-yaade-palette]")
      const row = page.locator(paletteRows).first()
      await expectLocatorVisible(row)
      await expect
        .poll(async () => (await row.boundingBox())?.height ?? 0)
        .toBeGreaterThanOrEqual(35)
      await expectListRows(page, {
        panel: "yaade:palette",
        minItems: 3,
        minRowHeight: 35,
        noResultsText: "No results.",
      })
      await page.keyboard.press("Escape")
    } finally {
      await app.close()
    }
  })
})
