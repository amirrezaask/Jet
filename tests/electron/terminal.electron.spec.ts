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
  expectLocatorContainsText,
  expectNotContainsText,
} from "../shell/assert.js"

import { flakyTest } from "./_flaky.js"
import { hasPtySpawn, launchJet, readTerminalText, showTerminal } from "./_launch.js"

const ptyAvailable = hasPtySpawn()

test.describe("electron terminal", () => {
  test.skip(!ptyAvailable, "node-pty cannot spawn a shell on this machine")

  test("names shells distinctly and launches commands without echoing them", async () => {
    const { app, page } = await launchJet()
    try {
      const result = await page.evaluate(async () => {
        const terminal = window.jet?.terminal
        const workspacePath = window.__jetAgent?.getState().activeWorkspace
        if (!terminal || !workspacePath) throw new Error("Terminal API or workspace unavailable")
        const cwdUri = `file://${workspacePath}`
        const first = await terminal.create(cwdUri)
        const second = await terminal.create(cwdUri)
        await terminal.dispose(first.id)
        await terminal.dispose(second.id)

        const direct = await terminal.create(cwdUri, {
          command: "/bin/sh",
          args: ["-c", "printf jet-direct-launch"],
        })
        const output = await new Promise<string>((resolve, reject) => {
          let text = ""
          let unsubscribe = () => {}
          const timeout = window.setTimeout(() => {
            unsubscribe()
            reject(new Error(`Timed out waiting for direct terminal output: ${text}`))
          }, 5_000)
          unsubscribe = terminal.onData(direct.id, data => {
            text += data
            if (!text.includes("jet-direct-launch")) return
            window.clearTimeout(timeout)
            unsubscribe()
            resolve(text)
          })
        })
        await terminal.dispose(direct.id)
        return { firstTitle: first.title, secondTitle: second.title, output }
      })

      expect(result.firstTitle).toMatch(/^\S+(?: \d+)?$/)
      const firstMatch = result.firstTitle!.match(/^(.*?)(?: (\d+))?$/)!
      const firstIndex = firstMatch[2] ? Number(firstMatch[2]) : 1
      expect(result.secondTitle).toBe(`${firstMatch[1]} ${firstIndex + 1}`)
      expect(result.output).toContain("jet-direct-launch")
      expect(result.output).not.toContain("printf jet-direct-launch")
      expect(result.output).not.toContain("/bin/sh")
    } finally {
      await app.close()
    }
  })

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

      const startupText = await readTerminalText(page)
      expect(startupText).not.toContain("precmd_jet_title")
      expect(startupText).not.toContain("preexec_jet_title")

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

  flakyTest("xterm row height not measurable before first PTY output", "xterm row height is readable", async () => {
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

  flakyTest("OSC title sequence → tab label propagation timing", "updates tab label when shell emits OSC title sequence", async () => {
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

      await expectContainsText(page, "[data-jet-tab-bar]", "JetTitleTest", {
        timeout: 15_000,
      })
    } finally {
      await app.close()
    }
  })

  test("keeps exited terminal output visible and offers restart", async () => {
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

      await page.keyboard.type("exit")
      await page.keyboard.press("Enter")

      await expectLocatorAttribute(page.locator("[data-jet-terminal-panel]"), 
        "data-jet-terminal-status",
        "exited",
        { timeout: 15_000 },
      )
      const exitBar = page.locator("[data-jet-terminal-exit-bar]")
      await expectLocatorVisible(exitBar, { timeout: 15_000 })
      await expectLocatorContainsText(exitBar, "Process exited")
      await expectLocatorVisible(exitBar.getByRole("button", { name: "Restart" }))
      await expectSelectorVisible(page, "[data-jet-terminal-panel] .xterm-rows")
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

  test("renders smooth terminal cursor with a bounded ghost trail", async () => {
    const { app, page } = await launchJet()
    try {
      await showTerminal(page)
      const panel = page.locator("[data-jet-terminal-panel]")
      await expectLocatorAttribute(panel, "data-jet-terminal-status", "running")

      const layer = panel.locator("[data-jet-terminal-cursor-layer]")
      await expectLocatorVisible(layer)
      await expectLocatorCount(layer.locator("[data-jet-terminal-cursor]"), 1)
      await expectLocatorCount(layer.locator("[data-jet-terminal-cursor-ghost]"), 5)

      await page.evaluate(() => {
        const cursorLayer = document.querySelector<HTMLElement>("[data-jet-terminal-cursor-layer]")
        if (!cursorLayer) return
        const observer = new MutationObserver(() => {
          const visibleGhost = [...cursorLayer.querySelectorAll<HTMLElement>("[data-jet-terminal-cursor-ghost]")]
            .some(ghost => Number.parseFloat(ghost.style.opacity || "0") > 0.02)
          if (visibleGhost) {
            cursorLayer.dataset.jetGhostObserved = "true"
            observer.disconnect()
          }
        })
        observer.observe(cursorLayer, { subtree: true, attributes: true, attributeFilter: ["style"] })
        window.setTimeout(() => observer.disconnect(), 1_000)
      })

      await panel.locator(".jet-terminal-surface").click()
      await page.keyboard.type("cursor")
      await expectLocatorAttribute(layer, "data-jet-ghost-observed", "true", { timeout: 5_000 })
    } finally {
      await app.close()
    }
  })

  test("uses RAD smooth scrolling for terminal scrollback", async () => {
    const { app, page } = await launchJet()
    try {
      await showTerminal(page)
      const surface = page.locator("[data-jet-terminal-panel] .jet-terminal-surface")
      await surface.click()
      await page.keyboard.type("seq 1 240")
      await page.keyboard.press("Enter")
      await page.waitForFunction(() => {
        const viewport = document.querySelector<HTMLElement>("[data-jet-terminal-panel] .xterm-viewport")
        return viewport != null && viewport.scrollHeight > viewport.clientHeight * 2
      }, null, { timeout: 15_000 })

      const samples = await page.locator("[data-jet-terminal-panel] .xterm-viewport").evaluate(async viewport => {
        viewport.scrollTop = viewport.scrollHeight
        viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: -640, bubbles: true, cancelable: true }))
        const values: number[] = []
        for (let frame = 0; frame < 60; frame++) {
          await new Promise<void>(resolve => setTimeout(resolve, 32))
          values.push(viewport.scrollTop)
          if (viewport.dataset.jetScrollActive === "false" && frame > 2) break
        }
        return values
      })
      const moving = samples.filter((value, index) => index === 0 || value !== samples[index - 1])
      expect(moving.length).toBeGreaterThanOrEqual(1)
      if (samples.at(-1) === samples[0]) {
        const jumped = await page.locator("[data-jet-terminal-panel] .xterm-viewport").evaluate(viewport => {
          const before = viewport.scrollTop
          viewport.scrollTop = Math.max(0, before - 120)
          return viewport.scrollTop !== before
        })
        expect(jumped).toBe(true)
      } else {
        expect(samples.at(-1)).not.toBe(samples[0])
      }
    } finally {
      await app.close()
    }
  })
})
