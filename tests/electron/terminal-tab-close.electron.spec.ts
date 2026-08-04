import { expect, test } from "@playwright/test"
import {
  expectLocatorCount,
  expectLocatorVisible,
} from "../shell/assert.js"
import { execCommand, hasPtySpawn, launchJet } from "./_launch.js"

const ptyAvailable = hasPtySpawn()

test.describe.skip("terminal tab close behavior", () => {
  test.skip(!ptyAvailable, "node-pty cannot spawn a shell on this machine")

  test("session terminal sub-tabs middle-close the clicked tab without activating it", async () => {
    const { app, page } = await launchJet()
    try {
      await execCommand(page, "terminal.new")
      await page.locator('[data-yaade-session-mode-tab="terminal"]').click()
      await expectLocatorVisible(
        page.locator("[data-yaade-session-terminal-workspace]"),
      )

      await page.locator("[data-yaade-new-session-terminal]").click()
      await page.locator("[data-yaade-new-session-terminal]").click()
      const tabs = page.locator("[data-yaade-session-terminal-tab]")
      await expectLocatorCount(tabs, 3)
      const middleTabId = await tabs.nth(1).getAttribute(
        "data-yaade-session-terminal-tab",
      )
      const activeTabId = await tabs.nth(2).getAttribute(
        "data-yaade-session-terminal-tab",
      )
      expect(middleTabId).toBeTruthy()
      expect(activeTabId).toBeTruthy()
      const middleTab = page.locator(
        `[data-yaade-session-terminal-tab="${middleTabId}"]`,
      )
      const activeTab = page.locator(
        `[data-yaade-session-terminal-tab="${activeTabId}"]`,
      )
      await expect.poll(() => activeTab.getAttribute("data-state")).toBe("active")

      await middleTab.click({ button: "middle" })
      await expectLocatorCount(
        page.locator(
          `[data-yaade-session-terminal-tab="${middleTabId}"]`,
        ),
        0,
      )
      await expect.poll(() => activeTab.getAttribute("data-state")).toBe("active")
      await expectLocatorCount(page.getByRole("alertdialog"), 0)

      await page.locator("[data-yaade-new-session-terminal]").click()
      await expectLocatorCount(tabs, 3)
      const previousActiveId = activeTabId
      const freshActiveId = await tabs.nth(2).getAttribute(
        "data-yaade-session-terminal-tab",
      )
      expect(freshActiveId).toBeTruthy()
      expect(previousActiveId).not.toBe(freshActiveId)
      const closeButton = page.locator(
        `[data-yaade-session-terminal-tab-close="${previousActiveId}"]`,
      )
      await expect
        .poll(() => closeButton.getAttribute("disabled"))
        .toBeNull()
      await closeButton.click()
      await expectLocatorCount(
        page.locator(
          `[data-yaade-session-terminal-tab="${previousActiveId}"]`,
        ),
        0,
      )
      const freshActiveTab = page.locator(
        `[data-yaade-session-terminal-tab="${freshActiveId}"]`,
      )
      await expect
        .poll(() => freshActiveTab.getAttribute("data-state"))
        .toBe("active")

      const activeInput = page.locator(
        `[data-yaade-session-terminal-pane="${freshActiveId}"] .xterm-helper-textarea`,
      )
      await activeInput.focus()
      await page.keyboard.type("echo used")
      await freshActiveTab.click({ button: "middle" })
      await expectLocatorVisible(page.getByRole("alertdialog"))
      await expectLocatorCount(
        page.locator(
          `[data-yaade-session-terminal-tab="${freshActiveId}"]`,
        ),
        1,
      )
      await page.locator('[data-yaade-confirm="cancel"]').click()
    } finally {
      await app.close()
    }
  })
})
