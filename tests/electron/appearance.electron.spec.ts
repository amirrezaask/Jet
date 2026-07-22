import { expect, test } from "@playwright/test"
import {
  expectLocatorCount,
  expectLocatorVisible,
  expectSelectorVisible,
} from "../shell/assert.js"

import { hasPtySpawn, launchJet, showTerminal } from "./_launch.js"

const ptyAvailable = hasPtySpawn()

test.describe("electron appearance and terminal-first UX", () => {
  test.skip(!ptyAvailable, "node-pty cannot spawn a shell on this machine")

  test("applies theme changes to terminal", async () => {
    const { app, page } = await launchJet()
    try {
      await page.evaluate(async () => {
        localStorage.clear()
        await window.__gharargahAgent!.waitForReady()
        await window.__gharargahAgent!.executeCommand("ui.setTheme.glass-blue")
      })
      await showTerminal(page)
      await page.waitForSelector("[data-gharargah-terminal-panel] .xterm", { timeout: 30_000 })
      await page.waitForSelector("[data-gharargah-terminal-panel] .gharargah-terminal-surface", {
        timeout: 15_000,
      })

      await expectSelectorVisible(page, "[data-gharargah-terminal-panel]")
      await expectSelectorVisible(page, "[data-gharargah-home]")

      await expect
        .poll(() => page.evaluate(() => localStorage.getItem("jet-theme-id")))
        .toBe("glass-blue")

      await expect
        .poll(() =>
          page.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue("--gharargah-bg").trim(),
          ),
        )
        .toBe("#05070c")

      await expect
        .poll(() =>
          page.evaluate(() => {
            const readBlur = (el: Element) => {
              const cs = getComputedStyle(el)
              const blur = cs.backdropFilter || cs.getPropertyValue("-webkit-backdrop-filter")
              return blur && blur !== "none" ? blur : ""
            }
            const surface = document.querySelector(
              "[data-gharargah-terminal-panel] .gharargah-terminal-surface",
            )
            const modal = document.querySelector("[data-gharargah-terminal-modal]")
            if (!surface || !modal) return ""
            return `${readBlur(surface)}|${readBlur(modal)}`
          }),
        )
        .toMatch(/blur\(/)

      await page.evaluate(async () => {
        await window.__gharargahAgent!.executeCommand("settings.show")
      })

      await expectSelectorVisible(page, "[data-gharargah-settings-overlay]")
      await expectLocatorCount(page.locator("[data-gharargah-theme-option]"), 5)
      await expectSelectorVisible(page, "[data-gharargah-theme-option='default-dark']")
      await expectSelectorVisible(page, "[data-gharargah-theme-option='default-light']")
      await expectSelectorVisible(page, "[data-gharargah-theme-option='glass-blue']")
      await expectSelectorVisible(page, "[data-gharargah-theme-option='glass-red']")
      await expectSelectorVisible(page, "[data-gharargah-theme-option='glass-green']")

      await page.locator("[data-gharargah-theme-option='glass-red']").click()
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem("jet-theme-id")))
        .toBe("glass-red")

      await expect
        .poll(() =>
          page.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue("--gharargah-bg").trim(),
          ),
        )
        .toBe("#0a0506")

      await expect
        .poll(() =>
          page.evaluate(() => document.documentElement.dataset.gharargahSurface),
        )
        .toBe("glass")

      await page.locator("[data-gharargah-theme-option='default-dark']").click()
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem("jet-theme-id")))
        .toBe("default-dark")
      await expect
        .poll(() =>
          page.evaluate(() => document.documentElement.dataset.gharargahSurface),
        )
        .toBe("default")
    } finally {
      await app.close()
    }
  })

  test("shows agent launch menu from home New session", async () => {
    const { app, page } = await launchJet()
    try {
      const launcher = page.getByRole("button", { name: "New session" }).first()
      await expectLocatorVisible(launcher)
      await launcher.click()

      await expectLocatorVisible(page.getByRole("menuitem", { name: "Terminal" }))
      await expectLocatorVisible(page.getByRole("menuitem", { name: "Codex" }))
      await expectLocatorVisible(page.getByRole("menuitem", { name: "Claude" }))
      await expectLocatorVisible(page.getByRole("menuitem", { name: "Cursor Agent" }))
    } finally {
      await app.close()
    }
  })
})
