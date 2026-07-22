import { expect, test } from "@playwright/test"
import {
  expectLocatorCount,
  expectLocatorVisible,
  expectSelectorHidden,
  expectSelectorVisible,
} from "../shell/assert.js"

import { hasPtySpawn, launchJet, showTerminal, execCommand } from "./_launch.js"
import { expectListRows } from "../helpers/list.js"

const ptyAvailable = hasPtySpawn()

test.describe("electron terminal explorer", () => {
  test.skip(!ptyAvailable, "node-pty cannot spawn a shell on this machine")

  test("terminal.new opens modal and home cards list sessions", async () => {
    const { app, page } = await launchJet()
    try {
      await showTerminal(page)
      await expectSelectorVisible(page, "[data-gharargah-terminal-modal]")
      await expectSelectorVisible(page, "[data-gharargah-terminal-panel]")
      await page.keyboard.press("Escape")
      await expectLocatorCount(page.locator("[data-gharargah-terminal-modal]"), 0)

      await execCommand(page, "terminal.new")
      await expectSelectorVisible(page, "[data-gharargah-terminal-modal]", { timeout: 20_000 })
      await page.keyboard.press("Escape")

      const cards = page.locator("[data-gharargah-terminal-card]")
      await expectLocatorVisible(cards.first())
      await expect.poll(async () => cards.count()).toBeGreaterThanOrEqual(2)
    } finally {
      await app.close()
    }
  })

  test("terminal.show toggles terminal modal", async () => {
    const { app, page } = await launchJet()
    try {
      await showTerminal(page)
      await expectSelectorVisible(page, "[data-gharargah-terminal-panel]")
      await execCommand(page, "terminal.show")
      await expectLocatorCount(page.locator("[data-gharargah-terminal-modal]"), 0)
      await expectSelectorVisible(page, "[data-gharargah-home]")
    } finally {
      await app.close()
    }
  })

  test("terminal list labels and switches sessions without the sidebar", async () => {
    const { app, page } = await launchJet()
    try {
      const workspaceName = await page.evaluate(() => window.__gharargahAgent!.listWorkspaces()[0]?.name ?? "")
      await execCommand(page, "terminal.new")
      await execCommand(page, "terminal.new")
      await execCommand(page, "terminal.list")

      await expectListRows(page, {
        panel: "gharargah:palette",
        minItems: 1,
        needle: `${workspaceName}:`,
        noResultsText: "No open terminals",
      })
      await page.getByRole("option").first().click()
      await expectSelectorVisible(page, "[data-gharargah-terminal-modal]")
      await expectSelectorVisible(page, "[data-gharargah-terminal-panel]")
      await expectSelectorHidden(page, "[data-gharargah-workspace-sidebar]")
    } finally {
      await app.close()
    }
  })

  test("home New session menu launches terminal for project", async () => {
    const { app, page } = await launchJet()
    try {
      const workspaceName = await page.evaluate(() => window.__gharargahAgent!.listWorkspaces()[0]?.name ?? "")
      const section = page.locator(
        `[data-gharargah-project-section][data-gharargah-project-name="${workspaceName}"]`,
      )
      await expectLocatorVisible(section)
      await section.getByRole("button", { name: "New session" }).click()
      const menu = page.locator('[data-slot="dropdown-menu-content"]')
      await expectLocatorVisible(menu)
      await menu.locator('[data-slot="dropdown-menu-item"]', { hasText: "Blank session" }).click()
      await expectSelectorVisible(page, "[data-gharargah-terminal-modal]", { timeout: 20_000 })
      await expectSelectorVisible(page, "[data-gharargah-terminal-panel]")
    } finally {
      await app.close()
    }
  })
})
