import { expect, test } from "@playwright/test"
import { hasPtySpawn, launchJet, readTerminalText, showTerminal } from "./_launch.js"

const ptyAvailable = hasPtySpawn()

test.describe("electron terminal", () => {
  test.skip(!ptyAvailable, "node-pty cannot spawn a shell on this machine")

  test("runs ls and shows fixture directory listing", async () => {
    const { app, page } = await launchJet()
    try {
      await showTerminal(page)

      await page.locator("[data-jet-terminal-panel] .jet-terminal-surface").click()
      await page.evaluate(() => {
        const textarea = document.querySelector(
          "[data-jet-terminal-panel] .xterm-helper-textarea",
        ) as HTMLTextAreaElement | null
        textarea?.focus()
      })

      await page.waitForFunction(
        () => {
          const text = document.querySelector("[data-jet-terminal-panel] .xterm-rows")?.textContent ?? ""
          return text.trim().length > 0
        },
        null,
        { timeout: 15_000 },
      )

      await page.keyboard.type("ls")
      await page.keyboard.press("Enter")

      await page.waitForFunction(
        () => {
          const text = document.querySelector("[data-jet-terminal-panel] .xterm-rows")?.textContent ?? ""
          return text.includes("package.json") || text.includes("src")
        },
        null,
        { timeout: 15_000 },
      )

      const text = await readTerminalText(page)
      expect(text).toMatch(/package\.json|src/)
    } finally {
      await app.close()
    }
  })

  test("xterm row height is readable", async () => {
    const { app, page } = await launchJet()
    try {
      await showTerminal(page)

      await page.waitForFunction(
        () => {
          const row = document.querySelector("[data-jet-terminal-panel] .xterm-rows .xterm-row") as HTMLElement | null
          return row != null && row.getBoundingClientRect().height >= 10
        },
        null,
        { timeout: 15_000 },
      )

      const rowHeight = await page.evaluate(() => {
        const row = document.querySelector("[data-jet-terminal-panel] .xterm-rows .xterm-row") as HTMLElement | null
        return row?.getBoundingClientRect().height ?? 0
      })
      expect(rowHeight).toBeGreaterThanOrEqual(10)
    } finally {
      await app.close()
    }
  })

  test("updates tab label when shell emits OSC title sequence", async () => {
    const { app, page } = await launchJet()
    try {
      await showTerminal(page)

      await page.locator("[data-jet-terminal-panel] .jet-terminal-surface").click()
      await page.evaluate(() => {
        const textarea = document.querySelector(
          "[data-jet-terminal-panel] .xterm-helper-textarea",
        ) as HTMLTextAreaElement | null
        textarea?.focus()
      })

      await page.waitForFunction(
        () => {
          const text = document.querySelector("[data-jet-terminal-panel] .xterm-rows")?.textContent ?? ""
          return text.trim().length > 0
        },
        null,
        { timeout: 15_000 },
      )

      await page.keyboard.type("echo -ne '\\033]0;JetTitleTest\\007'")
      await page.keyboard.press("Enter")

      await expect(page.locator("[data-jet-tab-bar]")).toContainText("JetTitleTest", {
        timeout: 15_000,
      })
    } finally {
      await app.close()
    }
  })

  test("xterm viewport fills terminal surface below tab bar", async () => {
    const { app, page } = await launchJet()
    try {
      await showTerminal(page)

      const layout = await page.evaluate(() => {
        const surface = document.querySelector(
          "[data-jet-terminal-panel] .jet-terminal-surface",
        ) as HTMLElement | null
        const viewport = document.querySelector(
          "[data-jet-terminal-panel] .xterm-viewport",
        ) as HTMLElement | null
        if (!surface || !viewport) return null
        const surfaceRect = surface.getBoundingClientRect()
        const viewportRect = viewport.getBoundingClientRect()
        return {
          surfaceHeight: surfaceRect.height,
          viewportHeight: viewportRect.height,
          viewportTop: viewportRect.top - surfaceRect.top,
        }
      })

      expect(layout).not.toBeNull()
      expect(layout!.surfaceHeight).toBeGreaterThan(48)
      expect(layout!.viewportHeight).toBeGreaterThan(24)
      expect(layout!.viewportTop).toBeGreaterThanOrEqual(0)
      expect(layout!.viewportTop).toBeLessThan(8)
    } finally {
      await app.close()
    }
  })
})
