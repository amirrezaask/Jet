import { expect, test } from "@playwright/test"
import {
  expectLocatorVisible,
  expectSelectorVisible,
} from "../shell/assert.js"
import {
  execCommand,
  launchJet,
  pressMod,
  waitForMux,
} from "./_launch.js"

test.describe("mux tabs", () => {
  test("boots with horizontal tab strip and one window", async () => {
    const { app, page } = await launchJet()
    try {
      await waitForMux(page)
      await expectSelectorVisible(page, "[data-yaade-mux][data-orientation=horizontal]")
      await expectSelectorVisible(page, "[data-yaade-mux-tab-strip]")
      await expect
        .poll(async () => page.locator("[data-yaade-mux-tab]").count())
        .toBeGreaterThanOrEqual(1)
      await expectSelectorVisible(page, "[data-yaade-mux-window]")
      await expectSelectorVisible(page, "[data-yaade-terminal-panel]")
      // Persistent pane header — title text visible without hover.
      await expectSelectorVisible(page, "[data-yaade-mux-pane-chrome]")
      await expectSelectorVisible(page, "[data-yaade-mux-pane-drag]")
      const titleHandle = page.locator("[data-yaade-mux-pane-title]").first()
      await expect
        .poll(async () => titleHandle.getAttribute("aria-label"))
        .toMatch(/.+/)
      await expect
        .poll(async () => ((await titleHandle.textContent()) ?? "").trim().length)
        .toBeGreaterThan(0)
    } finally {
      await app.close()
    }
  })

  test("clears macOS traffic lights beside horizontal tabs", async () => {
    const { app, page } = await launchJet()
    try {
      await waitForMux(page)
      await page.addInitScript(() => {
        const connection = {
          activeUrl: window.location.origin,
          localUrl: window.location.origin,
          mode: "local" as const,
          startupError: null,
        }
        window.yaadeDesktop = Object.freeze({
          windowChrome: Object.freeze({
            customTitlebar: true as const,
            platform: "darwin" as const,
            titlebarHeight: 40,
            trafficLights: true,
          }),
          getServerConnection: async () => connection,
          connectToServer: async () => connection,
        })
      })
      await page.reload({ waitUntil: "domcontentloaded" })
      await waitForMux(page)

      const spacer = page.locator(
        "[data-yaade-mux-tab-strip] [data-yaade-traffic-light-spacer]",
      )
      await expectLocatorVisible(spacer)

      const firstTab = page.locator("[data-yaade-mux-tab]").first()
      await expectLocatorVisible(firstTab)
      await expect
        .poll(async () => {
          const [tabBox, spacerBox] = await Promise.all([
            firstTab.boundingBox(),
            spacer.boundingBox(),
          ])
          if (!tabBox || !spacerBox) return null
          return {
            tabAfterSpacer: tabBox.x >= spacerBox.x + spacerBox.width - 1,
          }
        })
        .toEqual({ tabAfterSpacer: true })
    } finally {
      await app.close()
    }
  })

  test("creates and closes windows from the strip", async () => {
    const { app, page } = await launchJet()
    try {
      await waitForMux(page)
      const before = await page.locator("[data-yaade-mux-tab]").count()
      await page.locator("[data-yaade-mux-new-tab]").first().click()
      await expect
        .poll(async () => page.locator("[data-yaade-mux-tab]").count())
        .toBe(before + 1)

      const lastTab = page.locator("[data-yaade-mux-tab]").last()
      const tabId = await lastTab.getAttribute("data-yaade-mux-tab")
      expect(tabId).toBeTruthy()
      await page.locator(`[data-yaade-mux-close-tab="${tabId}"]`).click()
      await expect
        .poll(async () => page.locator("[data-yaade-mux-tab]").count())
        .toBe(before)
    } finally {
      await app.close()
    }
  })

  test("toggles tab strip orientation", async () => {
    const { app, page } = await launchJet()
    try {
      await waitForMux(page)
      await expectSelectorVisible(
        page,
        "[data-yaade-mux][data-orientation=horizontal]",
      )
      await expectSelectorVisible(page, "[data-yaade-mux-icon-deck]")
      await expectSelectorVisible(page, "[data-yaade-mux-deck-icon]")
      await expectSelectorVisible(page, "[data-yaade-mux-deck-library]")
      // Horizontal: left-aligned capsule pills + deck library + +.
      const strip = page.locator("[data-yaade-mux-tab-strip][data-orientation=horizontal]")
      const stripBox = await strip.boundingBox()
      const tabBox = await strip.locator("[data-yaade-mux-tab]").first().boundingBox()
      const newBox = await strip.locator("[data-yaade-mux-new-tab]").boundingBox()
      expect(stripBox).toBeTruthy()
      expect(tabBox).toBeTruthy()
      expect(newBox).toBeTruthy()
      expect(tabBox!.x).toBeLessThan(newBox!.x)
      // Capsule pills use h-6; strip uses compact chrome (~2rem).
      expect(tabBox!.height).toBeGreaterThanOrEqual(18)
      expect(tabBox!.height).toBeLessThanOrEqual(24)
      expect(tabBox!.height).toBeLessThanOrEqual(stripBox!.height)
      expect(stripBox!.height).toBeLessThanOrEqual(34)
      // Tabs sit in the left half after traffic lights / deck library.
      const tabCenter = tabBox!.x + tabBox!.width / 2
      expect(tabCenter).toBeLessThan(stripBox!.x + stripBox!.width * 0.55)

      await execCommand(page, "mux.toggleTabOrientation")
      await expectSelectorVisible(
        page,
        "[data-yaade-mux][data-orientation=vertical]",
      )
      // Vertical strip uses the same frosted glass treatment.
      const verticalStrip = page.locator(
        "[data-yaade-mux-tab-strip][data-orientation=vertical]",
      )
      await expect
        .poll(async () => {
          const cls = (await verticalStrip.getAttribute("class")) ?? ""
          return cls.includes("backdrop-blur") || cls.includes("bg-background/50")
        })
        .toBe(true)

      await execCommand(page, "mux.toggleTabOrientation")
      await expectSelectorVisible(
        page,
        "[data-yaade-mux][data-orientation=horizontal]",
      )
    } finally {
      await app.close()
    }
  })

  test("context menus open on chrome, tabs, and terminal", async () => {
    const { app, page } = await launchJet()
    try {
      await waitForMux(page)

      await page.locator("[data-yaade-mux-pane-drag]").first().click({
        button: "right",
      })
      await expectSelectorVisible(page, "[data-yaade-mux-pane-context-menu]")
      await page.keyboard.press("Escape")

      await page.locator("[data-yaade-mux-tab]").first().click({ button: "right" })
      await expectSelectorVisible(page, "[data-yaade-mux-tab-context-menu]")
      await page.keyboard.press("Escape")

      await page.locator("[data-yaade-terminal-panel]").first().click({
        button: "right",
      })
      await expectSelectorVisible(page, "[data-yaade-mux-terminal-context-menu]")
      await page.keyboard.press("Escape")
    } finally {
      await app.close()
    }
  })
})

test.describe("mux tiling", () => {
  test("split right creates a second pane", async () => {
    const { app, page } = await launchJet()
    try {
      await waitForMux(page)
      await expect
        .poll(async () => page.locator("[data-yaade-mux-pane]").count())
        .toBe(1)
      await page.locator("[data-yaade-mux-split=right]").first().click()
      await expect
        .poll(async () => page.locator("[data-yaade-mux-pane]").count(), {
          timeout: 15_000,
        })
        .toBeGreaterThanOrEqual(2)
      await expect
        .poll(async () => page.locator("[data-yaade-terminal-panel]").count())
        .toBeGreaterThanOrEqual(2)
    } finally {
      await app.close()
    }
  })

  test("focus neighbor moves between split panes", async () => {
    const { app, page } = await launchJet()
    try {
      await waitForMux(page)
      await page.locator("[data-yaade-mux-split=right]").first().click()
      await expect
        .poll(async () => page.locator("[data-yaade-mux-pane]").count())
        .toBeGreaterThanOrEqual(2)

      const focusedBefore = await page
        .locator("[data-yaade-mux-pane][data-focused]")
        .getAttribute("data-yaade-mux-pane")
      expect(focusedBefore).toBeTruthy()

      await execCommand(page, "mux.focusLeft")
      await expect
        .poll(async () => {
          const focused = await page
            .locator("[data-yaade-mux-pane][data-focused]")
            .getAttribute("data-yaade-mux-pane")
          return focused && focused !== focusedBefore ? focused : null
        })
        .toBeTruthy()
    } finally {
      await app.close()
    }
  })

  test("git button opens Git workspace in a new split", async () => {
    const { app, page } = await launchJet()
    try {
      await waitForMux(page)
      await expect
        .poll(async () => page.locator("[data-yaade-mux-pane]").count())
        .toBe(1)
      await expectSelectorVisible(page, "[data-yaade-mux-open-git]")
      await page.locator("[data-yaade-mux-open-git]").first().click()
      await expect
        .poll(async () => page.locator("[data-yaade-mux-pane]").count(), {
          timeout: 15_000,
        })
        .toBeGreaterThanOrEqual(2)
      await expectSelectorVisible(page, "[data-yaade-mux-pane-kind=git]")
      await expectSelectorVisible(page, "[data-yaade-git-workspace]")
      // Terminal pane remains; git is an additional split.
      await expectSelectorVisible(page, "[data-yaade-terminal-panel]")
    } finally {
      await app.close()
    }
  })

  test("Mod-n opens neovim; Mod-g opens git", async () => {
    const { app, page } = await launchJet()
    try {
      await waitForMux(page)
      await expect
        .poll(async () => page.locator("[data-yaade-mux-pane]").count())
        .toBe(1)

      await pressMod(page, "n")
      await expect
        .poll(async () => page.locator("[data-yaade-mux-pane]").count(), {
          timeout: 15_000,
        })
        .toBeGreaterThanOrEqual(2)
      await expect
        .poll(async () =>
          page.locator('[data-yaade-mux-pane-title][aria-label="Neovim"]').count(),
        )
        .toBeGreaterThanOrEqual(1)

      await pressMod(page, "g")
      await expectSelectorVisible(page, "[data-yaade-mux-pane-kind=git]", {
        timeout: 15_000,
      })
      await expectSelectorVisible(page, "[data-yaade-git-workspace]")
      await expectSelectorVisible(page, "[data-yaade-terminal-panel]")
    } finally {
      await app.close()
    }
  })

  test("Mod-d shell split inherits the source pane cwd", async () => {
    const { app, page } = await launchJet()
    try {
      await waitForMux(page)
      await expectSelectorVisible(page, "[data-yaade-terminal-panel]")

      const shellPaneId = await page
        .locator("[data-yaade-mux-pane-kind=terminal]")
        .first()
        .getAttribute("data-yaade-mux-pane")
      expect(shellPaneId).toBeTruthy()

      let shellPtyId: string | null = null
      await expect
        .poll(
          async () => {
            shellPtyId = await page.evaluate(paneId => {
              const host = document.querySelector(
                `[data-yaade-mux-terminal-host="${paneId}"] [data-yaade-terminal-panel]`,
              )
              const id = host?.getAttribute("data-yaade-terminal-pty-id") || ""
              return id.length > 0 ? id : null
            }, shellPaneId!)
            return shellPtyId
          },
          { timeout: 15_000 },
        )
        .toBeTruthy()

      const nestedName = `cwd-modd-${Date.now().toString(36)}`
      await page.evaluate(
        async ({ id, dir }) => {
          const terminal = (
            window as Window & {
              yaade?: {
                terminal?: {
                  write: (ptyId: string, data: string) => Promise<unknown>
                  getCwd: (ptyId: string) => Promise<string | null>
                }
              }
            }
          ).yaade?.terminal
          if (!terminal?.write || !terminal.getCwd) {
            throw new Error("terminal write/getCwd unavailable")
          }
          await terminal.write(id, `mkdir -p ${dir} && cd ${dir}\n`)
          const deadline = Date.now() + 10_000
          while (Date.now() < deadline) {
            const live = await terminal.getCwd(id)
            if (live && (live.includes(`/${dir}`) || live.includes(`%2F${dir}`))) {
              return
            }
            await new Promise(r => setTimeout(r, 50))
          }
          throw new Error(`shell did not cd into ${dir}`)
        },
        { id: shellPtyId!, dir: nestedName },
      )

      await page
        .locator(`[data-yaade-mux-pane="${shellPaneId}"] [data-yaade-mux-pane-drag]`)
        .click()
      await execCommand(page, "mux.splitRight")
      await expect
        .poll(async () => page.locator("[data-yaade-mux-pane-kind=terminal]").count())
        .toBeGreaterThanOrEqual(2)

      await expect
        .poll(
          async () => {
            const panes = page.locator("[data-yaade-mux-pane-kind=terminal]")
            const count = await panes.count()
            for (let i = 0; i < count; i++) {
              const paneId = await panes.nth(i).getAttribute("data-yaade-mux-pane")
              if (!paneId || paneId === shellPaneId) continue
              const cwdLeaf = await page.evaluate(async id => {
                const host = document.querySelector(
                  `[data-yaade-mux-terminal-host="${id}"] [data-yaade-terminal-panel]`,
                )
                const ptyId = host?.getAttribute("data-yaade-terminal-pty-id") || ""
                if (!ptyId) return null
                const terminal = (
                  window as Window & {
                    yaade?: {
                      terminal?: { getCwd: (ptyId: string) => Promise<string | null> }
                    }
                  }
                ).yaade?.terminal
                const cwd = await terminal?.getCwd?.(ptyId)
                if (!cwd) return null
                const path = decodeURIComponent(cwd.replace(/^file:\/\//, ""))
                return path.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? null
              }, paneId)
              if (cwdLeaf === nestedName) return cwdLeaf
            }
            return null
          },
          { timeout: 15_000 },
        )
        .toBe(nestedName)
    } finally {
      await app.close()
    }
  })

  test("git and neovim splits use the shell process cwd", async () => {
    const { app, page } = await launchJet()
    try {
      await waitForMux(page)
      await expectSelectorVisible(page, "[data-yaade-terminal-panel]")

      const shellPaneId = await page
        .locator("[data-yaade-mux-pane-kind=terminal]")
        .first()
        .getAttribute("data-yaade-mux-pane")
      expect(shellPaneId).toBeTruthy()

      let shellPtyId: string | null = null
      await expect
        .poll(
          async () => {
            shellPtyId = await page.evaluate(paneId => {
              const host = document.querySelector(
                `[data-yaade-mux-terminal-host="${paneId}"] [data-yaade-terminal-panel]`,
              )
              const id = host?.getAttribute("data-yaade-terminal-pty-id") || ""
              return id.length > 0 ? id : null
            }, shellPaneId!)
            return shellPtyId
          },
          { timeout: 15_000 },
        )
        .toBeTruthy()

      const nestedName = `cwd-split-${Date.now().toString(36)}`
      await page.evaluate(
        async ({ id, dir }) => {
          const terminal = (
            window as Window & {
              yaade?: {
                terminal?: {
                  write: (ptyId: string, data: string) => Promise<unknown>
                  getCwd: (ptyId: string) => Promise<string | null>
                }
              }
            }
          ).yaade?.terminal
          if (!terminal?.write || !terminal.getCwd) {
            throw new Error("terminal write/getCwd unavailable")
          }
          if (!(await terminal.getCwd(id))) throw new Error("missing spawn cwd")
          await terminal.write(id, `mkdir -p ${dir} && cd ${dir}\n`)
          const deadline = Date.now() + 10_000
          while (Date.now() < deadline) {
            const live = await terminal.getCwd(id)
            if (live && (live.includes(`/${dir}`) || live.includes(`%2F${dir}`))) {
              return
            }
            await new Promise(r => setTimeout(r, 50))
          }
          throw new Error(`shell did not cd into ${dir}`)
        },
        { id: shellPtyId!, dir: nestedName },
      )

      await page.locator("[data-yaade-mux-open-git]").first().click()
      await expectSelectorVisible(page, "[data-yaade-mux-pane-kind=git]")
      await expect
        .poll(async () => {
          const root = await page
            .locator("[data-yaade-mux-pane-kind=git] [data-yaade-git-root]")
            .getAttribute("data-yaade-git-root")
          return root?.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? null
        }, { timeout: 10_000 })
        .toBe(nestedName)

      await page.locator("[data-yaade-mux-pane-kind=git] [data-yaade-mux-close-pane]").click()
      await expect
        .poll(async () => page.locator("[data-yaade-mux-pane-kind=git]").count())
        .toBe(0)

      await page
        .locator(`[data-yaade-mux-pane="${shellPaneId}"] [data-yaade-mux-pane-drag]`)
        .click()
      await page.locator("[data-yaade-mux-open-nvim]").first().click()
      await expect
        .poll(async () =>
          page.locator('[data-yaade-mux-pane-title][aria-label="Neovim"]').count(),
        )
        .toBeGreaterThanOrEqual(1)

      const nvimPaneId = await page
        .locator('[data-yaade-mux-pane-title][aria-label="Neovim"]')
        .first()
        .evaluate(el => el.closest("[data-yaade-mux-pane]")?.getAttribute("data-yaade-mux-pane") ?? null)
      expect(nvimPaneId).toBeTruthy()

      await expect
        .poll(async () => {
          const nvimPty = await page.evaluate(paneId => {
            const host = document.querySelector(
              `[data-yaade-mux-terminal-host="${paneId}"] [data-yaade-terminal-panel]`,
            )
            const id = host?.getAttribute("data-yaade-terminal-pty-id") || ""
            return id.length > 0 ? id : null
          }, nvimPaneId!)
          if (!nvimPty) return null
          return page.evaluate(async id => {
            const terminal = (
              window as Window & {
                yaade?: {
                  terminal?: { getCwd: (ptyId: string) => Promise<string | null> }
                }
              }
            ).yaade?.terminal
            const cwd = await terminal?.getCwd?.(id)
            if (!cwd) return null
            const path = decodeURIComponent(cwd.replace(/^file:\/\//, ""))
            return path.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? null
          }, nvimPty)
        }, { timeout: 15_000 })
        .toBe(nestedName)
    } finally {
      await app.close()
    }
  })

  test("neovim button opens nvim in a new terminal split", async () => {
    const { app, page } = await launchJet()
    try {
      await waitForMux(page)
      await expect
        .poll(async () => page.locator("[data-yaade-mux-pane]").count())
        .toBe(1)
      await expectSelectorVisible(page, "[data-yaade-mux-open-nvim]")
      await page.locator("[data-yaade-mux-open-nvim]").first().click()
      await expect
        .poll(async () => page.locator("[data-yaade-mux-pane]").count(), {
          timeout: 15_000,
        })
        .toBeGreaterThanOrEqual(2)
      await expect
        .poll(async () =>
          page.locator('[data-yaade-mux-pane-title][aria-label="Neovim"]').count(),
        )
        .toBeGreaterThanOrEqual(1)
      await expect
        .poll(async () => page.locator("[data-yaade-terminal-panel]").count())
        .toBeGreaterThanOrEqual(2)
    } finally {
      await app.close()
    }
  })

  test("quitting neovim closes its pane", async () => {
    const { app, page } = await launchJet()
    try {
      await waitForMux(page)
      await page.locator("[data-yaade-mux-open-nvim]").first().click()
      await expect
        .poll(async () =>
          page.locator('[data-yaade-mux-pane-title][aria-label="Neovim"]').count(),
        )
        .toBeGreaterThanOrEqual(1)

      const nvimPaneId = await page
        .locator('[data-yaade-mux-pane-title][aria-label="Neovim"]')
        .first()
        .evaluate(el => el.closest("[data-yaade-mux-pane]")?.getAttribute("data-yaade-mux-pane"))
      expect(nvimPaneId).toBeTruthy()

      let ptyId: string | null = null
      await expect
        .poll(async () => {
          ptyId = await page.evaluate(paneId => {
            const host = document.querySelector(
              `[data-yaade-mux-terminal-host="${paneId}"] [data-yaade-terminal-panel]`,
            )
            const id = host?.getAttribute("data-yaade-terminal-pty-id") || ""
            return id.length > 0 ? id : null
          }, nvimPaneId!)
          return ptyId
        }, { timeout: 15_000 })
        .toBeTruthy()

      // Force-quit neovim (:qa!) so the PTY exits and the pane auto-closes.
      await page.evaluate(async id => {
        const api = (
          window as Window & {
            yaade?: { terminal?: { write: (ptyId: string, data: string) => Promise<unknown> } }
          }
        ).yaade?.terminal
        if (!api?.write) throw new Error("terminal.write unavailable")
        await api.write(id, "\x1b:qa!\r")
      }, ptyId!)

      await expect
        .poll(
          async () =>
            page.locator('[data-yaade-mux-pane-title][aria-label="Neovim"]').count(),
          { timeout: 15_000 },
        )
        .toBe(0)
      await expect
        .poll(async () => page.locator("[data-yaade-mux-pane]").count())
        .toBe(1)
      await expect
        .poll(async () => page.locator("[data-yaade-confirm=accept]").count())
        .toBe(0)
    } finally {
      await app.close()
    }
  })

  test("closing the last pane closes the window without confirm", async () => {
    const { app, page } = await launchJet()
    try {
      await waitForMux(page)
      await expect
        .poll(async () => page.locator("[data-yaade-mux-tab]").count())
        .toBe(1)

      await page.locator("[data-yaade-terminal-panel]").first().click()
      await page.keyboard.type("echo yaade-last-pane")
      await expectSelectorVisible(page, "[data-yaade-mux-close-pane]")
      await page.locator("[data-yaade-mux-close-pane]").first().click()

      await expect
        .poll(async () => page.locator("[data-yaade-confirm=accept]").count())
        .toBe(0)
      await expect
        .poll(async () => page.locator("[data-yaade-mux-tab]").count())
        .toBe(0)
      await expectSelectorVisible(page, "[data-yaade-mux-empty]")
    } finally {
      await app.close()
    }
  })

  test("split down creates a stacked pane", async () => {
    const { app, page } = await launchJet()
    try {
      await waitForMux(page)
      await execCommand(page, "mux.splitDown")
      await expect
        .poll(async () => page.locator("[data-yaade-mux-pane]").count(), {
          timeout: 15_000,
        })
        .toBeGreaterThanOrEqual(2)
    } finally {
      await app.close()
    }
  })
})

test.describe("mux zoom", () => {
  test("zoom fills the window and restore returns the split", async () => {
    const { app, page } = await launchJet()
    try {
      await waitForMux(page)
      await execCommand(page, "mux.splitRight")
      await expect
        .poll(async () => page.locator("[data-yaade-mux-pane]").count())
        .toBeGreaterThanOrEqual(2)

      await page.locator("[data-yaade-mux-zoom]").first().click()
      await expectSelectorVisible(page, "[data-yaade-mux-window][data-zoomed]")
      await expect
        .poll(async () => page.locator("[data-yaade-mux-pane]").count())
        .toBe(1)

      await page.locator("[data-yaade-mux-zoom]").first().click()
      await expect
        .poll(async () => page.locator("[data-yaade-mux-window][data-zoomed]").count())
        .toBe(0)
      await expect
        .poll(async () => page.locator("[data-yaade-mux-pane]").count())
        .toBeGreaterThanOrEqual(2)
    } finally {
      await app.close()
    }
  })

  test("Mod-f toggles pane zoom", async () => {
    const { app, page } = await launchJet()
    try {
      await waitForMux(page)
      await execCommand(page, "mux.splitRight")
      await expect
        .poll(async () => page.locator("[data-yaade-mux-pane]").count())
        .toBeGreaterThanOrEqual(2)

      await page.locator("[data-yaade-terminal-panel]").first().click()
      await page.keyboard.press("Meta+KeyF")
      await expectSelectorVisible(page, "[data-yaade-mux-window][data-zoomed]")
      await expect
        .poll(async () => page.locator("[data-yaade-mux-pane]").count())
        .toBe(1)

      await page.keyboard.press("Meta+KeyF")
      await expect
        .poll(async () => page.locator("[data-yaade-mux-window][data-zoomed]").count())
        .toBe(0)
      await expect
        .poll(async () => page.locator("[data-yaade-mux-pane]").count())
        .toBeGreaterThanOrEqual(2)
    } finally {
      await app.close()
    }
  })
})

test.describe("mux switcher", () => {
  test("command palette opens via Mod-Shift-p with selectable commands", async () => {
    const { app, page } = await launchJet()
    try {
      await waitForMux(page)

      // Click the terminal host (pane chrome center is covered by the terminal layer).
      await page.locator("[data-yaade-terminal-panel]").first().click()
      await page.keyboard.press("Meta+Shift+KeyP")
      await expect
        .poll(async () => page.locator("[data-yaade-palette]").count(), {
          timeout: 10_000,
        })
        .toBeGreaterThan(0)
      await expectSelectorVisible(page, "[data-yaade-palette]")
      await expect
        .poll(
          async () =>
            page.locator('[data-yaade-list-panel="yaade:palette"] [data-yaade-list-item]').count(),
        )
        .toBeGreaterThan(0)

      await page.keyboard.type("Toggle Tab Orientation")
      await page.keyboard.press("Enter")
      await expect
        .poll(async () => page.locator("[data-yaade-palette]").count())
        .toBe(0)
    } finally {
      await app.close()
    }
  })

  test("Mod-k opens terminal switcher and Enter selects", async () => {
    const { app, page } = await launchJet()
    try {
      await waitForMux(page)
      await page.locator("[data-yaade-terminal-panel]").first().click()
      await page.keyboard.press("Meta+KeyK")
      await expect
        .poll(async () => page.locator("[data-yaade-palette]").count(), {
          timeout: 10_000,
        })
        .toBeGreaterThan(0)
      await expectSelectorVisible(page, "[data-yaade-palette]")
      await expect
        .poll(
          async () =>
            page.locator("[data-yaade-palette] [data-slot=row-label]").count(),
        )
        .toBeGreaterThan(0)
      await page.keyboard.press("Enter")
      await expect
        .poll(async () => page.locator("[data-yaade-palette]").count())
        .toBe(0)
    } finally {
      await app.close()
    }
  })

  test("terminal.list lists panes and selecting focuses the pane", async () => {
    const { app, page } = await launchJet()
    try {
      await waitForMux(page)
      await execCommand(page, "mux.newWindow")
      await expect
        .poll(async () => page.locator("[data-yaade-mux-tab]").count())
        .toBeGreaterThanOrEqual(2)

      const hasCommand = await page.evaluate(() =>
        Boolean(
          (
            window as Window & {
              __yaadeAgent?: { executeCommand: (id: string) => Promise<void> }
            }
          ).__yaadeAgent,
        ),
      )
      expect(hasCommand).toBe(true)

      await execCommand(page, "terminal.list")
      await expect
        .poll(async () => page.locator("[data-yaade-palette]").count(), {
          timeout: 10_000,
        })
        .toBeGreaterThan(0)

      const row = page.locator("[data-yaade-palette] [data-slot=row-label]").first()
      await expectLocatorVisible(row)
      const label = (await row.textContent()) ?? ""
      expect(label.length).toBeGreaterThan(0)
      expect(label.toLowerCase()).not.toBe("switch terminal…")

      await row.click()
      await expect
        .poll(async () => page.locator("[data-yaade-palette]").count(), {
          timeout: 10_000,
        })
        .toBe(0)
      await expectSelectorVisible(page, "[data-yaade-mux-window]")
      await expectSelectorVisible(page, "[data-yaade-terminal-panel]")
    } finally {
      await app.close()
    }
  })
})

async function pointerDrag(
  page: import("@playwright/test").Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  // Activate PointerSensor (distance: 6) and let TabDndRoot snapshot overlays.
  await page.mouse.move(from.x + 12, from.y + 4, { steps: 4 })
  await page.waitForTimeout(50)
  await page.mouse.move(to.x, to.y, { steps: 20 })
  await page.waitForTimeout(30)
  await page.mouse.up()
}

test.describe("mux drag dock", () => {
  test("pane chrome and window tabs expose drag handles", async () => {
    const { app, page } = await launchJet()
    try {
      await waitForMux(page)
      await execCommand(page, "mux.splitRight")
      await expect
        .poll(async () => page.locator("[data-yaade-mux-pane]").count())
        .toBeGreaterThanOrEqual(2)
      await expectSelectorVisible(page, "[data-yaade-mux-pane-drag]")
      await expect
        .poll(async () => page.locator("[data-yaade-mux-pane-drag]").count())
        .toBeGreaterThanOrEqual(2)
      await expectSelectorVisible(page, "[data-yaade-mux-tab-drag]")
    } finally {
      await app.close()
    }
  })

  test("dragging a pane onto another pane edge retile", async () => {
    const { app, page } = await launchJet()
    try {
      await waitForMux(page)
      await execCommand(page, "mux.splitRight")
      await expect
        .poll(async () => page.locator("[data-yaade-mux-pane]").count())
        .toBeGreaterThanOrEqual(2)

      const panes = page.locator("[data-yaade-mux-pane]")
      const leftId = await panes.nth(0).getAttribute("data-yaade-mux-pane")
      const rightId = await panes.nth(1).getAttribute("data-yaade-mux-pane")
      expect(leftId).toBeTruthy()
      expect(rightId).toBeTruthy()
      expect(leftId).not.toBe(rightId)

      const leftPtyBefore = await page.evaluate(id => {
        const host = document.querySelector(
          `[data-yaade-mux-terminal-host="${id}"] [data-yaade-terminal-panel]`,
        )
        return host?.getAttribute("data-yaade-terminal-pty-id") ?? null
      }, leftId!)

      const source = page.locator(
        `[data-yaade-mux-pane="${leftId}"] [data-yaade-mux-pane-drag]`,
      )
      const target = panes.nth(1)
      const srcBox = await source.boundingBox()
      const tgtBox = await target.boundingBox()
      expect(srcBox).toBeTruthy()
      expect(tgtBox).toBeTruthy()

      await pointerDrag(
        page,
        {
          x: srcBox!.x + srcBox!.width / 2,
          y: srcBox!.y + srcBox!.height / 2,
        },
        {
          // Bottom edge zone of the right pane → stacked retile
          x: tgtBox!.x + tgtBox!.width / 2,
          y: tgtBox!.y + tgtBox!.height * 0.9,
        },
      )

      await expect
        .poll(async () => page.locator("[data-yaade-mux-pane]").count())
        .toBe(2)
      await expectSelectorVisible(
        page,
        `[data-yaade-mux-pane="${leftId}"]`,
      )
      await expectSelectorVisible(
        page,
        `[data-yaade-mux-pane="${rightId}"]`,
      )

      // Persistent terminal hosts — same PTY after retile (no shell reset).
      if (leftPtyBefore) {
        await expect
          .poll(async () =>
            page.evaluate(id => {
              const host = document.querySelector(
                `[data-yaade-mux-terminal-host="${id}"] [data-yaade-terminal-panel]`,
              )
              return host?.getAttribute("data-yaade-terminal-pty-id") ?? null
            }, leftId!),
          )
          .toBe(leftPtyBefore)
      }
      await expectSelectorVisible(
        page,
        `[data-yaade-mux-terminal-host="${leftId}"]`,
      )
    } finally {
      await app.close()
    }
  })

  test("dragging a git pane onto a terminal pane edge retile", async () => {
    const { app, page } = await launchJet()
    try {
      await waitForMux(page)
      await expectSelectorVisible(page, "[data-yaade-mux-open-git]")
      await page.locator("[data-yaade-mux-open-git]").first().click()
      await expect
        .poll(async () => page.locator("[data-yaade-mux-pane]").count(), {
          timeout: 15_000,
        })
        .toBeGreaterThanOrEqual(2)
      await expectSelectorVisible(page, "[data-yaade-mux-pane-kind=git]")

      const gitPane = page.locator("[data-yaade-mux-pane-kind=git]")
      const gitId = await gitPane.getAttribute("data-yaade-mux-pane")
      expect(gitId).toBeTruthy()

      const termPane = page.locator(
        "[data-yaade-mux-pane-kind=terminal]",
      ).first()
      const termId = await termPane.getAttribute("data-yaade-mux-pane")
      expect(termId).toBeTruthy()
      expect(termId).not.toBe(gitId)

      const source = page.locator(
        `[data-yaade-mux-pane="${gitId}"] [data-yaade-mux-pane-drag]`,
      )
      const srcBox = await source.boundingBox()
      const tgtBox = await termPane.boundingBox()
      expect(srcBox).toBeTruthy()
      expect(tgtBox).toBeTruthy()

      await pointerDrag(
        page,
        {
          x: srcBox!.x + srcBox!.width / 2,
          y: srcBox!.y + srcBox!.height / 2,
        },
        {
          // Bottom edge of the terminal pane → stack git under it
          x: tgtBox!.x + tgtBox!.width / 2,
          y: tgtBox!.y + tgtBox!.height * 0.9,
        },
      )

      await expect
        .poll(async () => page.locator("[data-yaade-mux-pane]").count())
        .toBe(2)
      await expectSelectorVisible(
        page,
        `[data-yaade-mux-pane="${gitId}"][data-yaade-mux-pane-kind=git]`,
      )
      await expectSelectorVisible(
        page,
        `[data-yaade-mux-pane="${termId}"][data-yaade-mux-pane-kind=terminal]`,
      )
      await expectSelectorVisible(page, "[data-yaade-git-workspace]")
    } finally {
      await app.close()
    }
  })

  test("dragging a window tab docks into the active window", async () => {
    const { app, page } = await launchJet()
    try {
      await waitForMux(page)
      await page.locator("[data-yaade-mux-new-tab]").first().click()
      await expect
        .poll(async () => page.locator("[data-yaade-mux-tab]").count())
        .toBe(2)

      const firstTab = page.locator("[data-yaade-mux-tab]").first()
      const secondTab = page.locator("[data-yaade-mux-tab]").nth(1)
      const firstId = await firstTab.getAttribute("data-yaade-mux-tab")
      const secondId = await secondTab.getAttribute("data-yaade-mux-tab")
      expect(firstId).toBeTruthy()
      expect(secondId).toBeTruthy()

      // Keep first window active; dock the second into it.
      await firstTab.click()
      await expectSelectorVisible(
        page,
        `[data-yaade-mux-tab="${firstId}"][data-active]`,
      )

      const dragHandle = page.locator(`[data-yaade-mux-tab="${secondId}"]`)
      const pane = page.locator("[data-yaade-mux-pane]").first()
      const srcBox = await dragHandle.boundingBox()
      const paneBox = await pane.boundingBox()
      expect(srcBox).toBeTruthy()
      expect(paneBox).toBeTruthy()

      const from = {
        x: srcBox!.x + srcBox!.width / 2,
        y: srcBox!.y + srcBox!.height / 2,
      }
      const to = {
        x: paneBox!.x + paneBox!.width * 0.85,
        y: paneBox!.y + paneBox!.height / 2,
      }

      await page.mouse.move(from.x, from.y)
      await page.mouse.down()
      await page.mouse.move(from.x + 16, from.y + 4, { steps: 6 })
      await expect
        .poll(
          async () =>
            page
              .locator(`[data-yaade-mux-tab="${secondId}"][data-dragging]`)
              .count(),
          { timeout: 5_000 },
        )
        .toBe(1)
      // Drop overlays should register sites while a dock drag is active.
      await expect
        .poll(
          async () =>
            page.evaluate(() => {
              const el = document.querySelector(
                "[data-yaade-panel-drop-overlay]",
              )
              return el?.childElementCount ?? 0
            }),
          { timeout: 5_000 },
        )
        .toBeGreaterThan(0)
      await page.mouse.move(to.x, to.y, { steps: 24 })
      await page.waitForTimeout(40)
      await page.mouse.up()

      await expect
        .poll(async () => page.locator("[data-yaade-mux-tab]").count(), {
          timeout: 10_000,
        })
        .toBe(1)
      await expect
        .poll(async () => page.locator("[data-yaade-mux-pane]").count())
        .toBeGreaterThanOrEqual(2)
      await expect
        .poll(
          async () =>
            page.locator(`[data-yaade-mux-tab="${secondId}"]`).count(),
        )
        .toBe(0)
      await expectSelectorVisible(
        page,
        `[data-yaade-mux-tab="${firstId}"]`,
      )
    } finally {
      await app.close()
    }
  })
})

test.describe("mux persistence", () => {
  test("reload reattaches the existing PTY instead of spawning a new one", async () => {
    const { app, page } = await launchJet()
    try {
      await waitForMux(page)
      await expectSelectorVisible(page, "[data-yaade-terminal-panel]")

      await expect
        .poll(async () => {
          return page.evaluate(() => {
            const panel = document.querySelector(
              "[data-yaade-terminal-panel][data-yaade-terminal-pty-id]",
            )
            return panel?.getAttribute("data-yaade-terminal-pty-id") ?? null
          })
        }, { timeout: 15_000 })
        .toBeTruthy()

      const ptyId = await page.evaluate(() => {
        const panel = document.querySelector(
          "[data-yaade-terminal-panel][data-yaade-terminal-pty-id]",
        )
        return panel?.getAttribute("data-yaade-terminal-pty-id") ?? null
      })
      expect(ptyId).toBeTruthy()

      await page.reload({ waitUntil: "domcontentloaded" })
      await waitForMux(page)

      await expect
        .poll(async () => {
          return page.evaluate(expected => {
            const panel = document.querySelector(
              "[data-yaade-terminal-panel][data-yaade-terminal-pty-id]",
            )
            return panel?.getAttribute("data-yaade-terminal-pty-id") === expected
              ? expected
              : null
          }, ptyId)
        }, { timeout: 15_000 })
        .toBe(ptyId)
    } finally {
      await app.close()
    }
  })
})

