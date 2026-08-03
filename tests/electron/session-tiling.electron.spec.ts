import { expect, test } from "@playwright/test"
import {
  expectLocatorVisible,
  expectSelectorVisible,
} from "../shell/assert.js"
import { launchJet, openNewCliSession } from "./_launch.js"

test.describe("session tiling window manager", () => {
  test("closing a session pane hides it from the layout but keeps the sidebar row", async () => {
    const { app, page } = await launchJet()
    try {
      await openNewCliSession(page, "codex")
      await expectSelectorVisible(page, "[data-yaade-session-workspace]")
      await expectSelectorVisible(page, "[data-yaade-terminal-modal]")

      const sessionRow = page.locator("[data-yaade-sidebar-session]").first()
      await expectLocatorVisible(sessionRow)
      const sessionId = await sessionRow.getAttribute("data-yaade-sidebar-session")
      expect(sessionId).toBeTruthy()

      const closePane = page
        .locator("[data-yaade-session-pane-chrome] button[aria-label='Close tab']")
        .first()
      await closePane.click()

      await expect
        .poll(async () => page.locator("[data-yaade-terminal-modal]").count())
        .toBe(0)
      await expectSelectorVisible(
        page,
        `[data-yaade-sidebar-session="${sessionId}"]`,
      )

      await page.locator(`[data-yaade-sidebar-session="${sessionId}"]`).click()
      await expectSelectorVisible(page, "[data-yaade-terminal-modal]")
      await expectSelectorVisible(page, "[data-yaade-session-mode-dock]")
    } finally {
      await app.close()
    }
  })

  test("opening a second session splits the current pane", async () => {
    const { app, page } = await launchJet()
    try {
      await openNewCliSession(page, "codex")
      await openNewCliSession(page, "claude")

      await expectSelectorVisible(page, "[data-yaade-session-workspace]")
      await expect
        .poll(async () => page.locator("[data-yaade-panel-leaf]").count(), {
          timeout: 15_000,
        })
        .toBeGreaterThanOrEqual(2)
      await expect
        .poll(
          async () => page.locator("[data-yaade-session-pane-chrome]").count(),
          { timeout: 15_000 },
        )
        .toBeGreaterThanOrEqual(2)
      await expect
        .poll(
          async () => page.locator("[data-yaade-session-mode-dock]").count(),
          { timeout: 15_000 },
        )
        .toBeGreaterThanOrEqual(2)
      await expect
        .poll(async () =>
          page.locator("[data-yaade-session-pane-chrome][data-tab-id]").count(),
        )
        .toBeGreaterThanOrEqual(2)
    } finally {
      await app.close()
    }
  })

  test("two same-named agents open as distinct panes", async () => {
    const { app, page } = await launchJet()
    try {
      await openNewCliSession(page, "codex")
      await openNewCliSession(page, "codex")

      await expectSelectorVisible(page, "[data-yaade-session-workspace]")
      await expect
        .poll(
          async () => page.locator("[data-yaade-session-pane-chrome]").count(),
          { timeout: 15_000 },
        )
        .toBeGreaterThanOrEqual(2)
      const tabIds = await page
        .locator("[data-yaade-session-pane-chrome][data-tab-id]")
        .evaluateAll(els => els.map(el => el.getAttribute("data-tab-id")))
      expect(new Set(tabIds).size).toBe(tabIds.length)
      expect(tabIds.length).toBeGreaterThanOrEqual(2)
    } finally {
      await app.close()
    }
  })
})
