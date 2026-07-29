import { test } from "@playwright/test"
import { expectSelectorVisible } from "../shell/assert.js"
import { expectListRows } from "../helpers/list.js"
import {
  clickNewSession,
  execCommand,
  hasPtySpawn,
  launchJet,
  waitForHome,
} from "./_launch.js"

const ptyAvailable = hasPtySpawn()

test.describe("agent CLI picker layout", () => {
  test.skip(!ptyAvailable, "PTY support required for the new-session picker")

  test("keeps two-line provider rows readable at the largest UI font size", async () => {
    const { app, page } = await launchJet()
    try {
      await waitForHome(page)
      for (let step = 0; step < 6; step += 1) {
        await execCommand(page, "ui.zoomIn")
      }
      await clickNewSession(page)

      await expectSelectorVisible(page, "[data-gharargah-palette]")
      await expectListRows(page, {
        panel: "gharargah:palette",
        minItems: 5,
        minRowHeight: 80,
        needle: "Anthropic Claude Code CLI",
        noResultsText: "No matching agents.",
      })
    } finally {
      await app.close()
    }
  })
})
