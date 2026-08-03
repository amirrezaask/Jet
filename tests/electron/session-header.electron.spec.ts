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

  test("shows the agent title in agent mode without project or provider chrome", async () => {
    const { app, page } = await launchJet()
    try {
      const modal = await openNewCliSession(page, "codex")
      const header = modal.locator(
        "[data-yaade-terminal-modal-header]",
      )
      const title = header.locator(
        "[data-yaade-terminal-modal-title]",
      )

      await expectLocatorVisible(header)
      await expect
        .poll(() => title.evaluate(el => el.classList.contains("sr-only")))
        .toBe(false)
      await expectLocatorContainsText(title, "Codex")
      await expect
        .poll(async () => (await title.textContent()) ?? "")
        .not.toMatch(/\//)
      await expectLocatorCount(
        header.locator("[data-chat-header-provider]"),
        0,
      )
      await expectLocatorCount(
        header.locator("[data-yaade-terminal-launch-command]"),
        0,
      )
      await expectLocatorCount(
        header.locator("[data-yaade-session-status-label]"),
        0,
      )
      await expectLocatorCount(
        header.locator("[data-yaade-session-status-indicator]"),
        0,
      )
      await expectLocatorCount(
        header.locator("[data-yaade-session-project-name]"),
        0,
      )
      await expectLocatorCount(
        header.locator("[data-chat-header-model]"),
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
      const modal = page.locator("[data-yaade-terminal-modal]")
      const title = modal.locator(
        "[data-yaade-terminal-modal-title]",
      )
      const workspaceName = await page.evaluate(() => {
        const workspace = window.__yaadeAgent!.getState().activeWorkspace!
        return workspace.split("/").filter(Boolean).at(-1)!
      })

      await modal
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
