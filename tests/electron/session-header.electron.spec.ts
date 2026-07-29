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

  test("keeps project context without repeating the CLI provider", async () => {
    const { app, page } = await launchJet()
    try {
      const modal = await openNewCliSession(page, "codex")
      const header = modal.locator(
        "[data-gharargah-terminal-modal-header]",
      )
      const title = header.locator(
        "[data-gharargah-terminal-modal-title]",
      )
      const workspaceName = await page.evaluate(() => {
        const workspace = window.__gharargahAgent!.getState().activeWorkspace!
        return workspace.split("/").filter(Boolean).at(-1)
      })

      await expectLocatorVisible(header)
      await expectLocatorContainsText(title, workspaceName!)
      await expectLocatorCount(
        header.locator("[data-chat-header-provider]"),
        0,
      )
      await expectLocatorCount(
        header.locator("[data-gharargah-terminal-launch-command]"),
        0,
      )
      await expect
        .poll(async () => (await header.textContent()) ?? "")
        .not.toMatch(/codex/i)
    } finally {
      await app.close()
    }
  })

  test("does not repeat sample-workspace when the terminal title matches the project", async () => {
    const { app, page } = await launchJet()
    try {
      await showTerminal(page)
      const modal = page.locator("[data-gharargah-terminal-modal]")
      const title = modal.locator(
        "[data-gharargah-terminal-modal-title]",
      )
      const workspaceName = await page.evaluate(() => {
        const workspace = window.__gharargahAgent!.getState().activeWorkspace!
        return workspace.split("/").filter(Boolean).at(-1)!
      })

      await modal
        .locator("[data-gharargah-terminal-panel] .gharargah-terminal-surface")
        .click()
      await page.evaluate(() => {
        document
          .querySelector<HTMLTextAreaElement>(
            "[data-gharargah-terminal-panel] .xterm-helper-textarea",
          )
          ?.focus()
      })
      await page.waitForFunction(
        () =>
          (
            document.querySelector(
              "[data-gharargah-terminal-panel] .xterm-rows",
            )?.textContent ?? ""
          ).trim().length > 0,
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
