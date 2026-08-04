import { expect, test } from "@playwright/test"
import {
  expectLocatorCount,
  expectLocatorVisible,
  expectSelectorHidden,
  expectSelectorVisible,
} from "../shell/assert.js"

import {
  hasPtySpawn,
  launchJet,
  openNewAgentSession,
  showTerminal,
  execCommand,
  ensureSidebarLayout,
} from "./_launch.js"
import { expectListRows } from "../helpers/list.js"

const ptyAvailable = hasPtySpawn()

test.describe.skip("electron terminal explorer", () => {
  test.skip(!ptyAvailable, "node-pty cannot spawn a shell on this machine")

  test("terminal.new opens modal and sidebar lists sessions", async () => {
    const { app, page } = await launchJet()
    try {
      await ensureSidebarLayout(page)
      await showTerminal(page)
      await expectSelectorVisible(page, "[data-yaade-terminal-modal]")
      await expectSelectorVisible(page, "[data-yaade-terminal-panel]")
      await execCommand(page, "yaade.goHome")
      await expectLocatorCount(page.locator("[data-yaade-terminal-modal]"), 0)

      await execCommand(page, "terminal.new")
      await expectSelectorVisible(page, "[data-yaade-terminal-modal]", {
        timeout: 20_000,
      })
      await execCommand(page, "yaade.goHome")

      const sessions = page.locator("[data-yaade-sidebar-session]")
      await expectLocatorVisible(sessions.first())
      await expect.poll(async () => sessions.count()).toBeGreaterThanOrEqual(2)
    } finally {
      await app.close()
    }
  })

  test("terminal.show toggles terminal modal", async () => {
    const { app, page } = await launchJet()
    try {
      await showTerminal(page)
      await expectSelectorVisible(page, "[data-yaade-terminal-panel]")
      await execCommand(page, "terminal.show")
      await expectLocatorCount(page.locator("[data-yaade-terminal-modal]"), 0)
      await expectSelectorVisible(page, "[data-yaade-mission-sidebar]")
    } finally {
      await app.close()
    }
  })

  test("terminal list labels and switches sessions without the sidebar", async () => {
    const { app, page } = await launchJet()
    try {
      const workspaceName = await page.evaluate(
        () => window.__yaadeAgent!.listWorkspaces()[0]?.name ?? "",
      )
      await execCommand(page, "terminal.new")
      await execCommand(page, "terminal.new")
      await execCommand(page, "terminal.list")

      await expectListRows(page, {
        panel: "yaade:palette",
        minItems: 1,
        needle: `${workspaceName}:`,
        noResultsText: "No open terminals",
      })
      await page.getByRole("option").first().click()
      await expectSelectorVisible(page, "[data-yaade-terminal-modal]")
      await expectSelectorVisible(page, "[data-yaade-terminal-panel]")
      await expectSelectorHidden(page, "[data-yaade-workspace-sidebar]")
    } finally {
      await app.close()
    }
  })

  test("New session opens session workspace for project", async () => {
    const { app, page } = await launchJet()
    try {
      await ensureSidebarLayout(page)
      await expectSelectorVisible(page, "[data-yaade-mission-sidebar]")
      const modal = await openNewAgentSession(page)
      await expectLocatorVisible(modal)
      await expectSelectorVisible(page, "[data-yaade-terminal-panel]")
      await expectLocatorCount(
        modal.locator(
          "[data-yaade-terminal-modal-header] [data-yaade-session-archive]",
        ),
        0,
      )
    } finally {
      await app.close()
    }
  })
})
