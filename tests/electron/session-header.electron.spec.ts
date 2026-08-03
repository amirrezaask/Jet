import { expect, test } from "@playwright/test"
import {
  expectLocatorContainsText,
  expectLocatorCount,
  expectLocatorVisible,
} from "../shell/assert.js"
import {
  hasPtySpawn,
  launchJet,
  openNewCliSession,
  showTerminal,
} from "./_launch.js"

const ptyAvailable = hasPtySpawn()

test.describe("session header", () => {
  test.skip(!ptyAvailable, "PTY sessions are unavailable on this machine")

  test("shows a single pane titlebar with agent title and actions", async () => {
    const { app, page } = await launchJet()
    try {
      await openNewCliSession(page, "codex")
      const chrome = page.locator("[data-yaade-session-pane-chrome]").first()
      const title = chrome.locator("[data-yaade-session-pane-title]")

      await expectLocatorVisible(chrome)
      await expectLocatorContainsText(title, "Codex")
      await expect
        .poll(async () => (await title.textContent()) ?? "")
        .not.toMatch(/\//)
      // One titlebar row — chrome is also the modal header.
      await expectLocatorCount(page.locator("[data-yaade-terminal-modal-header]"), 1)
      await expectLocatorCount(
        chrome.locator("[data-yaade-open-in-app]"),
        1,
      )
      await expectLocatorCount(
        chrome.locator("[data-yaade-notification-bell]"),
        1,
      )
      await expectLocatorCount(
        chrome.locator("[data-chat-header-provider]"),
        0,
      )
      await expectLocatorCount(
        chrome.locator("[data-yaade-terminal-launch-command]"),
        0,
      )
      await expectLocatorCount(
        chrome.locator("[data-yaade-session-project-name]"),
        0,
      )
    } finally {
      await app.close()
    }
  })

  test("does not repeat sample-workspace when the terminal title matches the project", async () => {
    const { app, page } = await launchJet()
    try {
      await showTerminal(page)
      const title = page.locator("[data-yaade-session-pane-title]").first()
      const workspaceName = await page.evaluate(() => {
        const workspace = window.__yaadeAgent!.getState().activeWorkspace!
        return workspace.split("/").filter(Boolean).at(-1)!
      })

      await page
        .locator("[data-yaade-terminal-panel] .yaade-terminal-surface")
        .click()
      await page.evaluate(() => {
        document
          .querySelector<HTMLTextAreaElement>(
            "[data-yaade-terminal-panel] .xterm-helper-textarea",
          )
          ?.focus()
      })
      await page.waitForFunction(
        () => (window.__yaadeAgent?.getTerminalText?.() ?? "").trim().length > 0,
        null,
        { timeout: 15_000 },
      )

      await page.keyboard.type(
        `printf '\\033]0;${workspaceName}\\007'`,
      )
      await page.keyboard.press("Enter")

      await expect
        .poll(async () => (await title.textContent())?.trim(), {
          timeout: 15_000,
        })
        .toBe(workspaceName)
      await expect
        .poll(async () => (await title.textContent()) ?? "")
        .not.toContain(`${workspaceName} / ${workspaceName}`)
    } finally {
      await app.close()
    }
  })
})
