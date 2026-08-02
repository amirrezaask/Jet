import { expect, test } from "@playwright/test"
import {
  expectLocatorCount,
  expectLocatorVisible,
  expectSelectorVisible,
} from "../shell/assert.js"

import { hasPtySpawn, launchJet, openNewCliSession, showTerminal, waitForHome } from "./_launch.js"

const ptyAvailable = hasPtySpawn()

test.describe("electron appearance and terminal-first UX", () => {
  test.skip(!ptyAvailable, "node-pty cannot spawn a shell on this machine")

  test("applies theme changes to terminal", async () => {
    const { app, page } = await launchJet()
    try {
      await page.evaluate(async () => {
        localStorage.clear()
        await window.__gharargahAgent!.waitForReady()
        await window.__gharargahAgent!.executeCommand("ui.setTheme.default-dark")
      })
      await showTerminal(page)

      await expect
        .poll(() => page.evaluate(() => document.documentElement.dataset.gharargahSurface))
        .toBe("default")
      await expect
        .poll(() =>
          page.evaluate(() => {
            const selectors = [
              "[data-gharargah-terminal-modal]",
              "[data-gharargah-terminal-modal-header]",
              "[data-gharargah-session-mode-switch]",
            ]
            return selectors.map(selector => {
              const element = document.querySelector(selector)
              if (!element) return null
              const style = getComputedStyle(element)
              const background = style.backgroundColor
              const alphaMatch = background.match(/rgba\([^)]*,\s*([\d.]+)\)$/)
              return {
                opaque:
                  background !== "transparent" &&
                  background !== "rgba(0, 0, 0, 0)" &&
                  (!alphaMatch || Number(alphaMatch[1]) === 1),
                blurred:
                  (style.backdropFilter || style.getPropertyValue("-webkit-backdrop-filter")) !==
                  "none",
              }
            })
          }),
        )
        .toEqual([
          { opaque: true, blurred: true }, // session modal: liquid glass
          { opaque: true, blurred: true }, // session header: liquid glass chrome
          { opaque: true, blurred: true }, // mode dock: liquid glass island
        ])

      await expect
        .poll(() =>
          page.evaluate(() => {
            const dock = document.querySelector(
              "[data-gharargah-session-mode-dock]",
            )
            return dock?.getAttribute("data-gharargah-liquid-glass") ?? null
          }),
        )
        .toBe("island")

      await expect
        .poll(() =>
          page.evaluate(() =>
            Boolean(
              document.querySelector("[data-gharargah-liquid-refract-defs]"),
            ),
          ),
        )
        .toBe(true)

      await page.waitForSelector("[data-gharargah-terminal-panel] .xterm", { timeout: 30_000 })
      await page.waitForSelector("[data-gharargah-terminal-panel] .gharargah-terminal-surface", {
        timeout: 15_000,
      })

      await expectSelectorVisible(page, "[data-gharargah-terminal-panel]")
      await expectSelectorVisible(page, "[data-gharargah-mission-sidebar]")

      await expect
        .poll(() => page.evaluate(() => localStorage.getItem("jet-theme-id")))
        .toBe("default-dark")

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

      await expect
        .poll(() =>
          page.evaluate(() => {
            const surface = document.querySelector<HTMLElement>(
              "[data-gharargah-terminal-panel] .gharargah-terminal-surface",
            )
            if (!surface) return null
            const bg = getComputedStyle(surface).backgroundColor
            return {
              bg,
              inlineBg: surface.style.background,
            }
          }),
        )
        .toMatchObject({
          inlineBg: "",
        })

      await expect
        .poll(() =>
          page.evaluate(() => {
            const surface = document.querySelector<HTMLElement>(
              "[data-gharargah-terminal-panel] .gharargah-terminal-surface",
            )
            if (!surface) return ""
            return getComputedStyle(surface).backgroundColor
          }),
        )
        .not.toBe("rgb(0, 0, 0)")

      await page.evaluate(async () => {
        await window.__gharargahAgent!.executeCommand("settings.show")
      })

      await expectSelectorVisible(page, "[data-gharargah-settings-overlay]")
      await page.locator("[data-gharargah-settings-category='appearance']").click()
      await expectLocatorCount(page.locator("[data-gharargah-theme-option]"), 2)
      await expectSelectorVisible(page, "[data-gharargah-theme-option='default-dark']")
      await expectSelectorVisible(page, "[data-gharargah-theme-option='default-light']")

      await page.locator("[data-gharargah-theme-option='default-light']").click()
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem("jet-theme-id")))
        .toBe("default-light")

      await expect
        .poll(() =>
          page.evaluate(() => document.documentElement.dataset.gharargahSurface),
        )
        .toBe("default")

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

  test("New session opens agent CLI picker then terminal", async () => {
    const { app, page } = await launchJet()
    try {
      await waitForHome(page)
      const modal = await openNewCliSession(page, "codex")
      await expectLocatorVisible(modal)
      await expectSelectorVisible(page, "[data-gharargah-terminal-panel]")
      await expectLocatorCount(page.locator('[data-slot="dropdown-menu-content"]'), 0)
    } finally {
      await app.close()
    }
  })
})
