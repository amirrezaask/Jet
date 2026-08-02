import { expect, test } from "@playwright/test"
import { expectLocatorCount } from "../shell/assert.js"

import {
  execCommand,
  ensureSidebarLayout,
  launchJet,
  openSettings,
  openThemePicker,
} from "./_launch.js"

test.describe("electron shell settings", () => {
  test("Default Dark and Light keep readable semantic colors and visible focus", async ({}, testInfo) => {
    const { app, page } = await launchJet()
    try {
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.evaluate(async () => window.__gharargahAgent!.waitForReady())
      await ensureSidebarLayout(page)

      for (const theme of [
        { id: "default-dark", scheme: "dark" },
        { id: "default-light", scheme: "light" },
      ] as const) {
        await execCommand(page, `ui.setTheme.${theme.id}`)
        await expect
          .poll(() =>
            page.evaluate(() => ({
              scheme: getComputedStyle(document.documentElement).colorScheme,
              themeId: localStorage.getItem("jet-theme-id"),
            })),
          )
          .toEqual({ scheme: theme.scheme, themeId: theme.id })

        const contrast = await page.evaluate(() => {
          const canvas = document.createElement("canvas")
          canvas.width = 1
          canvas.height = 1
          const context = canvas.getContext("2d", { willReadFrequently: true })!
          const probe = document.createElement("span")
          probe.style.position = "fixed"
          probe.style.left = "-100px"
          document.body.append(probe)

          function rgb(variable: string): readonly [number, number, number] {
            probe.style.color = `var(${variable})`
            const color = getComputedStyle(probe).color
            context.clearRect(0, 0, 1, 1)
            context.fillStyle = color
            context.fillRect(0, 0, 1, 1)
            const pixels = context.getImageData(0, 0, 1, 1).data
            return [pixels[0]!, pixels[1]!, pixels[2]!]
          }

          function luminance(value: readonly [number, number, number]): number {
            const [red, green, blue] = value.map(channel => {
              const normalized = channel / 255
              return normalized <= 0.04045
                ? normalized / 12.92
                : ((normalized + 0.055) / 1.055) ** 2.4
            })
            return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!
          }

          function ratio(foreground: string, background: string): number {
            const foregroundLuminance = luminance(rgb(foreground))
            const backgroundLuminance = luminance(rgb(background))
            return (
              (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
              (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
            )
          }

          const rootStyle = getComputedStyle(document.documentElement)
          const report = {
            foreground: ratio("--foreground", "--background"),
            muted: ratio("--muted-foreground", "--background"),
            primary: ratio("--primary-foreground", "--primary"),
            destructive: ratio(
              "--destructive-foreground",
              "--destructive",
            ),
            input: ratio("--input", "--background"),
            focus: ratio("--ring", "--background"),
            sidebar: ratio("--sidebar-foreground", "--sidebar"),
            primaryMatchesSidebar:
              rootStyle.getPropertyValue("--primary").trim() ===
              rootStyle.getPropertyValue("--sidebar-primary").trim(),
          }
          probe.remove()
          return report
        })

        expect(contrast.foreground).toBeGreaterThanOrEqual(7)
        expect(contrast.muted).toBeGreaterThanOrEqual(4.5)
        expect(contrast.primary).toBeGreaterThanOrEqual(4.5)
        expect(contrast.destructive).toBeGreaterThanOrEqual(4.5)
        expect(contrast.input).toBeGreaterThanOrEqual(3)
        expect(contrast.focus).toBeGreaterThanOrEqual(3)
        expect(contrast.sidebar).toBeGreaterThanOrEqual(7)
        expect(contrast.primaryMatchesSidebar).toBe(true)

        const search = page.locator("[data-gharargah-sidebar-search-input]")
        await search.focus()
        await expect
          .poll(() => search.evaluate(element => getComputedStyle(element).boxShadow))
          .not.toBe("none")
        await testInfo.attach(`${theme.id}.png`, {
          body: Buffer.from(await page.screenshot(), "base64"),
          contentType: "image/png",
        })
      }
    } finally {
      await app.close()
    }
  })

  test("settings overlay lists themes and reset restores appearance", async () => {
    const { app, page } = await launchJet()
    try {
      await page.evaluate(() => localStorage.clear())
      await page.evaluate(async () => window.__gharargahAgent!.waitForReady())
      await execCommand(page, "ui.setTheme.default-light")
      await openSettings(page)
      await page
        .locator("[data-gharargah-settings-category='appearance']")
        .click()
      await expectLocatorCount(page.locator("[data-gharargah-theme-option]"), 2)

      await page.locator("[data-gharargah-theme-option='default-dark']").click()
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem("jet-theme-id")))
        .toBe("default-dark")

      await page.locator("[data-gharargah-theme-option='default-light']").click()
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem("jet-theme-id")))
        .toBe("default-light")

      await execCommand(page, "ui.resetAppearance")
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem("jet-theme-id")))
        .toBe("default-dark")
      await expect
        .poll(() =>
          page.evaluate(() =>
            getComputedStyle(document.documentElement)
              .getPropertyValue("--font-mono")
              .trim(),
          ),
        )
        .toContain("Commit Mono")
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

      const appearance = page.locator(
        "[data-gharargah-settings-category='appearance']",
      )
      const notifications = page.locator(
        "[data-gharargah-settings-category='notifications']",
      )
      await expect.poll(() => appearance.getAttribute("aria-selected")).toBe("true")
      await appearance.focus()
      await page.keyboard.press("ArrowDown")
      await expect
        .poll(() => notifications.getAttribute("aria-selected"))
        .toBe("true")
      await page
        .locator("[data-gharargah-settings-panel='notifications']")
        .waitFor({ state: "visible" })

      await appearance.click()
      await expectLocatorCount(
        page.locator("[data-gharargah-session-layout-option]"),
        0,
      )
      await expect
        .poll(() =>
          page.evaluate(() => {
            const raw = localStorage.getItem("jet-appearance-settings")
            if (!raw) return "sidebar"
            return JSON.parse(raw).sessionLayout ?? "sidebar"
          }),
        )
        .toBe("sidebar")

      await page.getByRole("button", { name: "Close settings" }).click()
      await openSettings(page)
      await expect
        .poll(() => appearance.getAttribute("aria-selected"))
        .toBe("true")
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
