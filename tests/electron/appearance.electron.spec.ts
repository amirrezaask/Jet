import { expect, test } from "@playwright/test"
import { hasPtySpawn, launchJet, showTerminal } from "./_launch.js"

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
      await showTerminal(page)
      await page.waitForSelector("[data-jet-terminal-panel] .jet-terminal-surface", {
        timeout: 15_000,
      })

      await expect(page.locator("[data-jet-list-panel='jet:terminal-explorer']")).toBeVisible()
      await expect(page.locator("[data-jet-terminal-panel]")).toBeVisible()

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

      await expect(page.locator("[data-jet-settings-overlay]")).toBeVisible()
      await expect(page.locator("[data-jet-theme-option]")).toHaveCount(8)
      await expect(page.locator("[data-jet-theme-option='ayu-dark']")).toBeVisible()
      await expect(page.locator("[data-jet-theme-option='everforest-dark']")).toBeVisible()
      await expect(page.locator("[data-jet-theme-option='gruvbox-light']")).toBeVisible()
      await expect(page.locator("[data-jet-theme-option='tokyonight-light']")).toBeVisible()
      await expect(page.locator("[data-jet-setting='terminal-cursor-motion-trail']")).toHaveAttribute("data-state", "on")
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
    const { app, page } = await launchJet()
    try {
      const terminalExplorer = page.locator("[data-jet-list-panel='jet:terminal-explorer']")
      await expect(terminalExplorer).toBeVisible()

      const launcher = page.getByRole("button", { name: "Launch agent" }).first()
      await expect(launcher).toBeVisible()
      await launcher.click()

      await expect(page.getByRole("menuitem", { name: "Codex" })).toBeVisible()
      await expect(page.getByRole("menuitem", { name: "Claude" })).toBeVisible()
      await expect(page.getByRole("menuitem", { name: "Cursor Agent" })).toBeVisible()
    } finally {
      await app.close()
    }
  })
})
