import { expect, test } from "@playwright/test"
import {
  expectContainsText,
  expectLocatorAttached,
  expectLocatorAttribute,
  expectLocatorCount,
  expectLocatorFocused,
  expectLocatorHidden,
  expectLocatorVisible,
  expectSelectorHidden,
  expectSelectorVisible,
} from "../shell/assert.js"

import { hasPtySpawn, launchJet } from "./_launch.js"

const ptyAvailable = hasPtySpawn()

test.describe("electron appearance and terminal-first UX", () => {
  test.skip(!ptyAvailable, "node-pty cannot spawn a shell on this machine")

  test("applies theme changes to terminal", async () => {
    const { app, page } = await launchJet()
    try {
      await page.evaluate(async () => {
        localStorage.clear()
        await window.__jetAgent!.waitForReady()
        await window.__jetAgent!.executeCommand("ui.setTheme.ayu-dark")
      })
      await page.evaluate(async () => {
        await window.__jetAgent!.executeCommand("terminal.show")
        await window.__jetAgent!.executeCommand("terminal.explorer.show")
      })
      await page.waitForSelector("[data-jet-terminal-panel] .xterm", { timeout: 30_000 })
      await page.waitForSelector("[data-jet-terminal-panel] .jet-terminal-surface", {
        timeout: 15_000,
      })

      await expectSelectorVisible(page, "[data-jet-list-panel='jet:terminal-explorer']")
      await expectSelectorVisible(page, "[data-jet-terminal-panel]")

      await expect
        .poll(() => page.evaluate(() => localStorage.getItem("jet-theme-id")))
        .toBe("ayu-dark")

      await expect
        .poll(() =>
          page.evaluate(() => {
            const el = document.querySelector(
              "[data-jet-terminal-panel] .jet-terminal-surface",
            ) as HTMLElement | null
            return el ? getComputedStyle(el).backgroundColor : ""
          }),
        )
        .toBe("rgb(10, 14, 20)")

      await page.evaluate(async () => {
        await window.__jetAgent!.executeCommand("settings.show")
      })

      await expectSelectorVisible(page, "[data-jet-settings-overlay]")
      await expectLocatorCount(page.locator("[data-jet-theme-option]"), 8)
      await expectSelectorVisible(page, "[data-jet-theme-option='ayu-dark']")
      await expectSelectorVisible(page, "[data-jet-theme-option='everforest-dark']")
      await expectSelectorVisible(page, "[data-jet-theme-option='gruvbox-light']")
      await expectSelectorVisible(page, "[data-jet-theme-option='tokyonight-light']")
      await expectLocatorAttribute(page.locator("[data-jet-setting='terminal-cursor-motion-trail']"), "data-state", "on")
      await page.locator("[data-jet-setting='terminal-cursor-style-bar']").click()
      await page.locator("[data-jet-setting='terminal-cursor-motion-off']").click()
      await expect
        .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--jet-cursor-style").trim()))
        .toBe("bar")
      await expect
        .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--jet-cursor-motion").trim()))
        .toBe("off")

      await page.locator("[data-jet-theme-option='gruvbox-light']").click()
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem("jet-theme-id")))
        .toBe("gruvbox-light")

      await expect
        .poll(() =>
          page.evaluate(() => {
            const el = document.querySelector(
              "[data-jet-terminal-panel] .jet-terminal-surface",
            ) as HTMLElement | null
            return el ? getComputedStyle(el).backgroundColor : ""
          }),
        )
        .toBe("rgb(251, 241, 199)")
    } finally {
      await app.close()
    }
  })

  test("shows agent launch menu from workspace chevron", async () => {
    test.skip(true, "agent UI not in tauri e2e scope")
    const { app, page } = await launchJet()
    try {
      const terminalExplorer = page.locator("[data-jet-list-panel='jet:terminal-explorer']")
      await expectLocatorVisible(terminalExplorer)

      const launcher = page.getByRole("button", { name: "Launch agent" }).first()
      await expectLocatorVisible(launcher)
      await launcher.click()

      await expectLocatorVisible(page.getByRole("menuitem", { name: "Codex" }))
      await expectLocatorVisible(page.getByRole("menuitem", { name: "Claude" }))
      await expectLocatorVisible(page.getByRole("menuitem", { name: "Cursor Agent" }))
    } finally {
      await app.close()
    }
  })
})
