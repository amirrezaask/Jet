import { expect, test } from "@playwright/test"
import { expectLocatorCount } from "../shell/assert.js"

import {
  execCommand,
  launchJet,
  openSettings,
  openThemePicker,
} from "./_launch.js"

test.describe("electron shell settings", () => {
  test("settings overlay lists themes and reset restores appearance", async () => {
    const { app, page } = await launchJet()
    try {
      await page.evaluate(() => localStorage.clear())
      await page.evaluate(async () => window.__gharargahAgent!.waitForReady())
      await execCommand(page, "ui.setTheme.glass-blue")
      await openSettings(page)
      await page
        .locator("[data-gharargah-settings-category='appearance']")
        .click()
      await expectLocatorCount(page.locator("[data-gharargah-theme-option]"), 5)

      await page.locator("[data-gharargah-theme-option='glass-red']").click()
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem("jet-theme-id")))
        .toBe("glass-red")

      await page.locator("[data-gharargah-font-preset='ui:system']").click()
      await expect
        .poll(() =>
          page.evaluate(() =>
            getComputedStyle(document.documentElement)
              .getPropertyValue("--font-sans")
              .trim(),
          ),
        )
        .toContain("system-ui")

      await page
        .locator("[data-gharargah-font-preset='mono:ibm-plex-mono']")
        .click()
      await expect
        .poll(() =>
          page.evaluate(() =>
            getComputedStyle(document.documentElement)
              .getPropertyValue("--font-mono")
              .trim(),
          ),
        )
        .toContain("IBM Plex Mono")

      await execCommand(page, "ui.resetAppearance")
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem("jet-theme-id")))
        .toBe("default-dark")
      await expect
        .poll(() =>
          page.evaluate(() =>
            getComputedStyle(document.documentElement)
              .getPropertyValue("--font-sans")
              .trim(),
          ),
        )
        .toContain("Geist")
    } finally {
      await app.close()
    }
  })

  test("theme picker command opens settings overlay", async () => {
    const { app, page } = await launchJet()
    try {
      await openThemePicker(page)
    } finally {
      await app.close()
    }
  })

  test("settings categories support keyboard navigation and appearance persists", async () => {
    const { app, page } = await launchJet()
    try {
      await page.evaluate(() => localStorage.clear())
      await page.evaluate(async () => window.__gharargahAgent!.waitForReady())
      await openSettings(page)

      const general = page.locator(
        "[data-gharargah-settings-category='general']",
      )
      const appearance = page.locator(
        "[data-gharargah-settings-category='appearance']",
      )
      await expect.poll(() => general.getAttribute("aria-selected")).toBe("true")
      await general.focus()
      await page.keyboard.press("ArrowDown")
      await expect.poll(() => appearance.getAttribute("aria-selected")).toBe("true")
      await page
        .locator("[data-gharargah-settings-panel='appearance']")
        .waitFor({ state: "visible" })

      await general.click()
      await page
        .locator("[data-gharargah-session-layout-option='tabs']")
        .click()
      await expect
        .poll(() =>
          page.evaluate(() => {
            const raw = localStorage.getItem("jet-appearance-settings")
            return raw ? JSON.parse(raw).sessionLayout : null
          }),
        )
        .toBe("tabs")

      await page.getByRole("button", { name: "Close settings" }).click()
      await openSettings(page)
      await expect
        .poll(() =>
          page
            .locator("[data-gharargah-session-layout-option='tabs']")
            .getAttribute("data-state"),
        )
        .toBe("on")
    } finally {
      await app.close()
    }
  })

  test("notification sound preference follows desktop delivery and persists", async () => {
    const { app, page } = await launchJet()
    try {
      await page.evaluate(async () => {
        await window.gharargah?.notifications?.setPreferences({
          desktopEnabled: false,
          soundEnabled: false,
        })
      })
      await openSettings(page)
      await page
        .locator("[data-gharargah-settings-category='notifications']")
        .click()

      const desktop = page.locator(
        "[data-gharargah-notification-pref='desktopEnabled']",
      )
      const sound = page.locator(
        "[data-gharargah-notification-pref='soundEnabled']",
      )
      const soundDisabled = () =>
        page.evaluate(() => {
          const control = document.querySelector(
            "[data-gharargah-notification-pref='soundEnabled']",
          )
          return control instanceof HTMLButtonElement && control.disabled
        })
      await expect.poll(soundDisabled).toBe(true)

      await desktop.click()
      await expect.poll(soundDisabled).toBe(false)
      await sound.click()
      await expect
        .poll(() =>
          page.evaluate(async () => {
            const prefs =
              await window.gharargah?.notifications?.getPreferences()
            return prefs?.soundEnabled ?? null
          }),
        )
        .toBe(true)
    } finally {
      await app.close()
    }
  })

  test("Electron settings can select a remote server or return to the bundled server", async () => {
    const { app, page } = await launchJet()
    try {
      await page.evaluate(() => {
        const calls: Array<string | null> = []
        ;(
          window as Window & { __serverCalls?: Array<string | null> }
        ).__serverCalls = calls
        window.gharargahDesktop = {
          getServerConnection: async () => ({
            activeUrl: "http://127.0.0.1:4747",
            localUrl: "http://127.0.0.1:4747",
            mode: "local",
            startupError: null,
          }),
          connectToServer: async (serverUrl) => {
            calls.push(serverUrl)
            return {
              activeUrl: serverUrl ?? "http://127.0.0.1:4747",
              localUrl: "http://127.0.0.1:4747",
              mode: serverUrl ? "remote" : "local",
              startupError: null,
            }
          },
        }
      })

      await openSettings(page)
      await page.locator("[data-gharargah-settings-category='server']").click()
      await expect
        .poll(() =>
          page.locator("[data-gharargah-active-server]").textContent(),
        )
        .toBe("http://127.0.0.1:4747")
      await page
        .getByRole("textbox", { name: "Remote server URL" })
        .fill("https://gharargah.example")
      await page.locator("[data-gharargah-connect-remote]").click()
      await expect
        .poll(() =>
          page.locator("[data-gharargah-active-server]").textContent(),
        )
        .toBe("https://gharargah.example")
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as Window & { __serverCalls?: Array<string | null> })
                .__serverCalls,
          ),
        )
        .toEqual(["https://gharargah.example"])

      await page.locator("[data-gharargah-use-bundled-server]").click()
      await expect
        .poll(() =>
          page.locator("[data-gharargah-active-server]").textContent(),
        )
        .toBe("http://127.0.0.1:4747")
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as Window & { __serverCalls?: Array<string | null> })
                .__serverCalls,
          ),
        )
        .toEqual(["https://gharargah.example", null])
    } finally {
      await app.close()
    }
  })
})
