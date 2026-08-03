import { expect, test } from "@playwright/test"
import { expectSelectorVisible } from "../shell/assert.js"
import { launchJet, openNewCliSession } from "./_launch.js"

test.describe("session tiling window manager", () => {
  test("closing a session tab hides it from the layout but keeps the sidebar row", async () => {
    const { app, page } = await launchJet()
    try {
      await openNewCliSession(page, "codex")
      await expectSelectorVisible(page, "[data-yaade-session-workspace]")
      await expectSelectorVisible(page, "[data-yaade-terminal-modal]")

      const sessionRow = page.locator("[data-yaade-sidebar-session]").first()
      await expect(sessionRow).toBeVisible()
      const sessionId = await sessionRow.getAttribute("data-yaade-sidebar-session")
      expect(sessionId).toBeTruthy()

      const closeTab = page
        .locator("[data-yaade-tab-bar] button[aria-label='Close tab']")
        .first()
      await closeTab.click()

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

  test("opening a second session stacks it as a tab in the session window", async () => {
    const { app, page } = await launchJet()
    try {
      await openNewCliSession(page, "codex")
      await openNewCliSession(page, "claude")

      await expectSelectorVisible(page, "[data-yaade-session-workspace]")
      await expect
        .poll(async () => page.locator("[data-yaade-tab-bar] [data-tab-id]").count())
        .toBeGreaterThanOrEqual(2)
      await expect
        .poll(async () => page.locator("[data-yaade-session-mode-dock]").count())
        .toBeGreaterThanOrEqual(1)
    } finally {
      await app.close()
    }
  })

  test("two same-named agents open as distinct tabs", async () => {
    const { app, page } = await launchJet()
    try {
      await openNewCliSession(page, "codex")
      await openNewCliSession(page, "codex")

      await expectSelectorVisible(page, "[data-yaade-session-workspace]")
      await expect
        .poll(async () => page.locator("[data-yaade-tab-bar] [data-tab-id]").count())
        .toBeGreaterThanOrEqual(2)
      const tabIds = await page
        .locator("[data-yaade-tab-bar] [data-tab-id]")
        .evaluateAll(els => els.map(el => el.getAttribute("data-tab-id")))
      expect(new Set(tabIds).size).toBe(tabIds.length)
    } finally {
      await app.close()
    }
  })
})
