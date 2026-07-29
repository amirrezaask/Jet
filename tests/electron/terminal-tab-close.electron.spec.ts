import { expect, test } from "@playwright/test"
import {
  expectLocatorCount,
  expectLocatorVisible,
} from "../shell/assert.js"
import { execCommand, hasPtySpawn, launchJet } from "./_launch.js"

const ptyAvailable = hasPtySpawn()

test.describe("terminal tab close behavior", () => {
  test.skip(!ptyAvailable, "node-pty cannot spawn a shell on this machine")

  test("top-level tabs close fresh shells without confirmation and confirm used shells", async () => {
    const { app, page } = await launchJet()
    try {
      await execCommand(page, "ui.setSessionLayout.tabs")
      await execCommand(page, "terminal.new")
      await expectLocatorVisible(page.locator("[data-gharargah-session-tabs]"))

      const firstTabId = await page
        .locator("[data-gharargah-session-tab]")
        .last()
        .getAttribute("data-gharargah-session-tab")
      expect(firstTabId).toBeTruthy()
      const firstTab = page.locator(
        `[data-gharargah-session-tab="${firstTabId}"]`,
      )

      await execCommand(page, "terminal.new")
      await expectLocatorCount(page.locator("[data-gharargah-session-tab]"), 2)
      const secondTabId = await page
        .locator("[data-gharargah-session-tab]")
        .last()
        .getAttribute("data-gharargah-session-tab")
      expect(secondTabId).toBeTruthy()
      const secondTab = page.locator(
        `[data-gharargah-session-tab="${secondTabId}"]`,
      )
      await expect.poll(() => secondTab.getAttribute("aria-selected")).toBe("true")

      await firstTab.click({ button: "middle" })
      await expectLocatorCount(
        page.locator(`[data-gharargah-session-tab="${firstTabId}"]`),
        0,
      )
      await expect.poll(() => secondTab.getAttribute("aria-selected")).toBe("true")
      await expectLocatorCount(page.getByRole("alertdialog"), 0)

      await execCommand(page, "terminal.new")
      await expectLocatorCount(page.locator("[data-gharargah-session-tab]"), 2)
      const freshTab = page.locator("[data-gharargah-session-tab]").last()
      const freshTabId = await freshTab.getAttribute("data-gharargah-session-tab")
      expect(freshTabId).toBeTruthy()
      await page
        .locator(`[data-gharargah-session-tab-close="${freshTabId}"]`)
        .click()
      await expectLocatorCount(
        page.locator(`[data-gharargah-session-tab="${freshTabId}"]`),
        0,
      )
      await expectLocatorCount(page.getByRole("alertdialog"), 0)

      await secondTab.click()
      const input = page.locator(
        `[data-gharargah-terminal-tab-id="${secondTabId}"] .xterm-helper-textarea`,
      )
      await input.focus()
      await page.keyboard.type("echo used")

      await secondTab.click({ button: "middle" })
      await expectLocatorVisible(page.getByRole("alertdialog"))
      await expectLocatorCount(
        page.locator(`[data-gharargah-session-tab="${secondTabId}"]`),
        1,
      )
      await page.locator('[data-gharargah-confirm="cancel"]').click()

      await page
        .locator(`[data-gharargah-session-tab-close="${secondTabId}"]`)
        .click()
      await expectLocatorVisible(page.getByRole("alertdialog"))
      await page.locator('[data-gharargah-confirm="accept"]').click()
      await expectLocatorCount(
        page.locator(`[data-gharargah-session-tab="${secondTabId}"]`),
        0,
      )
    } finally {
      await app.close()
    }
  })

  test("session terminal sub-tabs middle-close the clicked tab without activating it", async () => {
    const { app, page } = await launchJet()
    try {
      await execCommand(page, "terminal.new")
      await page.locator('[data-gharargah-session-mode-tab="terminal"]').click()
      await expectLocatorVisible(
        page.locator("[data-gharargah-session-terminal-workspace]"),
      )

      await page.locator("[data-gharargah-new-session-terminal]").click()
      await page.locator("[data-gharargah-new-session-terminal]").click()
      const tabs = page.locator("[data-gharargah-session-terminal-tab]")
      await expectLocatorCount(tabs, 3)
      const middleTabId = await tabs.nth(1).getAttribute(
        "data-gharargah-session-terminal-tab",
      )
      const activeTabId = await tabs.nth(2).getAttribute(
        "data-gharargah-session-terminal-tab",
      )
      expect(middleTabId).toBeTruthy()
      expect(activeTabId).toBeTruthy()
      const middleTab = page.locator(
        `[data-gharargah-session-terminal-tab="${middleTabId}"]`,
      )
      const activeTab = page.locator(
        `[data-gharargah-session-terminal-tab="${activeTabId}"]`,
      )
      await expect.poll(() => activeTab.getAttribute("data-state")).toBe("active")

      await middleTab.click({ button: "middle" })
      await expectLocatorCount(
        page.locator(
          `[data-gharargah-session-terminal-tab="${middleTabId}"]`,
        ),
        0,
      )
      await expect.poll(() => activeTab.getAttribute("data-state")).toBe("active")
      await expectLocatorCount(page.getByRole("alertdialog"), 0)

      const activeInput = page.locator(
        `[data-gharargah-session-terminal-pane="${activeTabId}"] .xterm-helper-textarea`,
      )
      await activeInput.focus()
      await page.keyboard.type("echo used")
      await activeTab.click({ button: "middle" })
      await expectLocatorVisible(page.getByRole("alertdialog"))
      await expectLocatorCount(
        page.locator(
          `[data-gharargah-session-terminal-tab="${activeTabId}"]`,
        ),
        1,
      )
      await page.locator('[data-gharargah-confirm="cancel"]').click()
    } finally {
      await app.close()
    }
  })
})
