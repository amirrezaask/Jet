import { expect, test } from "@playwright/test"
import {
  expectLocatorCount,
  expectLocatorVisible,
  expectSelectorVisible,
} from "../shell/assert.js"

import { hasPtySpawn, launchJet, openNewCliSession, showTerminal, waitForHome } from "./_launch.js"

const ptyAvailable = hasPtySpawn()

test.describe.skip("electron appearance and terminal-first UX", () => {
  test.skip(!ptyAvailable, "node-pty cannot spawn a shell on this machine")

  test("applies theme changes to terminal", async () => {
    const { app, page } = await launchJet()
    try {
      await page.evaluate(async () => {
        localStorage.clear()
        await window.__yaadeAgent!.waitForReady()
        await window.__yaadeAgent!.executeCommand("ui.setTheme.default-dark")
      })
      await showTerminal(page)

      await expect
        .poll(() => page.evaluate(() => document.documentElement.dataset.yaadeSurface))
        .toBe("default")
      await expect
        .poll(() =>
          page.evaluate(() => {
            const selectors = [
              "[data-yaade-terminal-modal]",
              "[data-yaade-terminal-modal-header]",
              "[data-yaade-session-mode-switch]",
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
              "[data-yaade-session-mode-dock]",
            )
            return dock?.getAttribute("data-yaade-liquid-glass") ?? null
          }),
        )
        .toBe("island")

      await expect
        .poll(() =>
          page.evaluate(() =>
            Boolean(
              document.querySelector("[data-yaade-liquid-refract-defs]"),
            ),
          ),
        )
        .toBe(true)

      await page.waitForSelector("[data-yaade-terminal-panel] .xterm", { timeout: 30_000 })
      await page.waitForSelector("[data-yaade-terminal-panel] .yaade-terminal-surface", {
        timeout: 15_000,
      })

      await expectSelectorVisible(page, "[data-yaade-terminal-panel]")
      await expectSelectorVisible(page, "[data-yaade-mission-sidebar]")

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
              "[data-yaade-terminal-panel] .yaade-terminal-surface",
            )
            const modal = document.querySelector("[data-yaade-terminal-modal]")
            if (!surface || !modal) return ""
            return `${readBlur(surface)}|${readBlur(modal)}`
          }),
        )
        .toMatch(/blur\(/)

      await expect
        .poll(() =>
          page.evaluate(() => {
            const surface = document.querySelector<HTMLElement>(
              "[data-yaade-terminal-panel] .yaade-terminal-surface",
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
              "[data-yaade-terminal-panel] .yaade-terminal-surface",
            )
            if (!surface) return ""
            return getComputedStyle(surface).backgroundColor
          }),
        )
        .not.toBe("rgb(0, 0, 0)")

      await page.evaluate(async () => {
        await window.__yaadeAgent!.executeCommand("settings.show")
      })

      await expectSelectorVisible(page, "[data-yaade-settings-overlay]")
      await page.locator("[data-yaade-settings-category='appearance']").click()
      await expectLocatorCount(page.locator("[data-yaade-theme-option]"), 2)
      await expectSelectorVisible(page, "[data-yaade-theme-option='default-dark']")
      await expectSelectorVisible(page, "[data-yaade-theme-option='default-light']")

      await page.locator("[data-yaade-theme-option='default-light']").click()
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem("jet-theme-id")))
        .toBe("default-light")

      await expect
        .poll(() =>
          page.evaluate(() => document.documentElement.dataset.yaadeSurface),
        )
        .toBe("default")

      await page.locator("[data-yaade-theme-option='default-dark']").click()
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem("jet-theme-id")))
        .toBe("default-dark")
      await expect
        .poll(() =>
          page.evaluate(() => document.documentElement.dataset.yaadeSurface),
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
      await expectSelectorVisible(page, "[data-yaade-terminal-panel]")
      await expectLocatorCount(page.locator('[data-slot="dropdown-menu-content"]'), 0)
    } finally {
      await app.close()
    }
  })
})
