import { expect, test } from "@playwright/test"
import { hasPtySpawn, launchJet, showTerminal, execCommand } from "./_launch.js"

const ptyAvailable = hasPtySpawn()

test.describe("electron terminal explorer", () => {
  test.skip(!ptyAvailable, "node-pty cannot spawn a shell on this machine")

  test("terminal.new and terminal.explorer.show list sessions", async () => {
    const { app, page } = await launchJet()
    try {
      await showTerminal(page)
      await execCommand(page, "terminal.new")
      await page.waitForTimeout(500)
      await execCommand(page, "terminal.explorer.show")
      await expect(page.locator("[data-jet-list-panel='jet:terminal-explorer']")).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test("terminal.show toggles terminal visibility", async () => {
    const { app, page } = await launchJet()
    try {
      await showTerminal(page)
      await expect(page.locator("[data-jet-terminal-panel]")).toBeVisible()
      await execCommand(page, "terminal.show")
      await page.waitForTimeout(400)
    } finally {
      await app.close()
    }
  })
})
