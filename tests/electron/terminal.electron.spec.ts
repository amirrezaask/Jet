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

import { focusTerminal, hasPtySpawn, launchJet, readTerminalText, showTerminal } from "./_launch.js"

const ptyAvailable = hasPtySpawn()

test.describe("electron terminal", () => {
  test.skip(!ptyAvailable, "node-pty cannot spawn a shell on this machine")

  test("names shells distinctly and launches commands without echoing them", async () => {
    const { app, page } = await launchJet()
    try {
      const result = await page.evaluate(async () => {
        const terminal = window.gharargah?.terminal
        const workspacePath = window.__gharargahAgent?.getState().activeWorkspace
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

  test("streams Unicode output without corrupting the terminal session", async () => {
    const { app, page } = await launchJet()
    try {
      const output = await page.evaluate(async () => {
        const terminal = window.gharargah?.terminal
        const workspacePath = window.__gharargahAgent?.getState().activeWorkspace
        if (!terminal || !workspacePath) throw new Error("Terminal API or workspace unavailable")
        const direct = await terminal.create(`file://${workspacePath}`, {
          command: "/bin/sh",
          args: ["-c", "printf 'سلام🙂 gharargah-unicode-tail'"],
        })
        const text = await new Promise<string>((resolve, reject) => {
          let received = ""
          let unsubscribe = () => {}
          const timeout = window.setTimeout(() => {
            unsubscribe()
            reject(new Error(`Timed out waiting for Unicode output: ${received}`))
          }, 5_000)
          unsubscribe = terminal.onData(direct.id, chunk => {
            received += chunk
            if (!received.includes("gharargah-unicode-tail")) return
            window.clearTimeout(timeout)
            unsubscribe()
            resolve(received)
          })
        })
        await terminal.dispose(direct.id)
        return text
      })

      expect(output).toContain("سلام🙂")
      expect(output).toContain("gharargah-unicode-tail")
    } finally {
      await app.close()
    }
  })

  test("preserves non-UTF-8 xterm binary input bytes", async () => {
    const { app, page } = await launchJet()
    try {
      const output = await page.evaluate(async () => {
        const terminal = window.gharargah?.terminal
        const workspacePath = window.__gharargahAgent?.getState().activeWorkspace
        if (!terminal || !workspacePath) throw new Error("Terminal API or workspace unavailable")
        const direct = await terminal.create(`file://${workspacePath}`, {
          command: "/bin/sh",
          args: ["-c", "stty raw -echo; od -An -t u1 -N 3"],
        })
        const text = new Promise<string>((resolve, reject) => {
          let received = ""
          let unsubscribe = () => {}
          const timeout = window.setTimeout(() => {
            unsubscribe()
            reject(new Error(`Timed out waiting for binary terminal input: ${received}`))
          }, 5_000)
          unsubscribe = terminal.onData(direct.id, chunk => {
            received += chunk
            if (!/0\s+128\s+255/.test(received)) return
            window.clearTimeout(timeout)
            unsubscribe()
            resolve(received)
          })
        })
        await terminal.writeBinary(
          direct.id,
          btoa(String.fromCharCode(0, 128, 255)),
        )
        const received = await text
        await terminal.dispose(direct.id)
        return received
      })

      expect(output).toMatch(/0\s+128\s+255/)
    } finally {
      await app.close()
    }
  })

  test("runs ls and shows fixture directory listing", async () => {
    const { app, page } = await launchJet()
    try {
      await showTerminal(page)

      await page.locator("[data-gharargah-terminal-panel] \.gharargah-terminal-surface").click()
      await page.evaluate(() => {
        const textarea = document.querySelector(
          "[data-gharargah-terminal-panel] .xterm-helper-textarea",
        ) as HTMLTextAreaElement | null
        textarea?.focus()
      })

      await page.waitForFunction(
        () => {
          const text = document.querySelector("[data-gharargah-terminal-panel] .xterm-rows")?.textContent ?? ""
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
          const text = document.querySelector("[data-gharargah-terminal-panel] .xterm-rows")?.textContent ?? ""
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
          const row = document.querySelector("[data-gharargah-terminal-panel] .xterm-rows > div") as HTMLElement | null
          return row != null && row.getBoundingClientRect().height >= 10
        },
        null,
        { timeout: 15_000 },
      )

      const rowHeight = await page.evaluate(() => {
        const row = document.querySelector("[data-gharargah-terminal-panel] .xterm-rows > div") as HTMLElement | null
        return row?.getBoundingClientRect().height ?? 0
      })
      expect(rowHeight).toBeGreaterThanOrEqual(10)
    } finally {
      await app.close()
    }
  })

  test("sends fitted geometry immediately after PTY creation", async () => {
    const { app, page } = await launchJet()
    try {
      await page.evaluate(() => {
        const terminal = window.gharargah?.terminal
        if (!terminal) throw new Error("Terminal API unavailable")
        const originalResize = terminal.resize.bind(terminal)
        const originalCreate = terminal.create.bind(terminal)
        const resizeCalls: Array<{ cols: number; rows: number }> = []
        const createCalls: Array<{ cols?: number; rows?: number }> = []
        terminal.create = async (cwdUri, launch) => {
          createCalls.push({ cols: launch?.cols, rows: launch?.rows })
          return originalCreate(cwdUri, launch)
        }
        terminal.resize = async (id, cols, rows) => {
          resizeCalls.push({ cols, rows })
          return originalResize(id, cols, rows)
        }
        ;(
          window as unknown as {
            __gharargahResizeCalls?: Array<{ cols: number; rows: number }>
            __gharargahCreateCalls?: Array<{ cols?: number; rows?: number }>
          }
        ).__gharargahResizeCalls = resizeCalls
        ;(
          window as unknown as {
            __gharargahCreateCalls?: Array<{ cols?: number; rows?: number }>
          }
        ).__gharargahCreateCalls = createCalls
      })

      await showTerminal(page)

      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (
                window as unknown as {
                  __gharargahResizeCalls?: Array<{
                    cols: number
                    rows: number
                  }>
                }
              ).__gharargahResizeCalls?.at(-1) ?? null,
          ),
        )
        .toEqual(
          expect.objectContaining({
            cols: expect.any(Number),
            rows: expect.any(Number),
          }),
        )
      const geometry = await page.evaluate(
        () =>
          (
            window as unknown as {
              __gharargahResizeCalls?: Array<{ cols: number; rows: number }>
            }
          ).__gharargahResizeCalls?.at(-1),
      )
      expect(geometry!.cols).toBeGreaterThan(80)
      expect(geometry!.rows).toBeGreaterThan(24)
      const initialGeometry = await page.evaluate(
        () =>
          (
            window as unknown as {
              __gharargahCreateCalls?: Array<{ cols?: number; rows?: number }>
            }
          ).__gharargahCreateCalls?.at(-1),
      )
      expect(initialGeometry).toEqual(geometry)
    } finally {
      await app.close()
    }
  })

  test("carriage-return progress updates overwrite the same line", async () => {
    const { app, page } = await launchJet()
    try {
      await showTerminal(page)
      await focusTerminal(page)

      const ptyId = await page
        .locator("[data-gharargah-terminal-panel]")
        .getAttribute("data-gharargah-terminal-pty-id")
      expect(ptyId).toBeTruthy()

      await page.evaluate(async id => {
        const terminal = window.gharargah?.terminal
        if (!terminal) throw new Error("Terminal API unavailable")
        // Run printf so CR is on the PTY → xterm display path (not shell line-edit).
        await terminal.write(
          id,
          "printf 'CR-TEST-AAAA\\rCR-TEST-BBBB\\n'; echo CR-TEST-DONE\n",
        )
      }, ptyId!)

      await expect
        .poll(async () => readTerminalText(page), { timeout: 10_000 })
        .toContain("CR-TEST-DONE")

      const text = await readTerminalText(page)
      expect(text).toContain("CR-TEST-BBBB")
      // Command echo still contains AAAA inside the printf quotes. A broken \\r path
      // would also leave AAAA in the printed progress line → 2+ occurrences.
      expect((text.match(/CR-TEST-AAAA/g) ?? []).length).toBe(1)
      // Progress line itself must be the rewritten BBBB form (no AAAA→BBBB stack).
      expect(text).toMatch(/CR-TEST-BBBB\s*CR-TEST-DONE/)
      expect(text).not.toMatch(/CR-TEST-AAAA\s*CR-TEST-BBBB/)
    } finally {
      await app.close()
    }
  })

  test("PTY winsize stays in sync with fitted xterm after layout settles", async () => {
    const { app, page } = await launchJet()
    try {
      await showTerminal(page)
      await focusTerminal(page)

      const ptyId = await page
        .locator("[data-gharargah-terminal-panel]")
        .getAttribute("data-gharargah-terminal-pty-id")
      expect(ptyId).toBeTruthy()

      await page.evaluate(async id => {
        const terminal = window.gharargah?.terminal
        if (!terminal) throw new Error("Terminal API unavailable")
        await terminal.write(id, "stty size; echo STTY-SIZE-DONE\n")
      }, ptyId!)

      await expect
        .poll(async () => readTerminalText(page), { timeout: 10_000 })
        .toContain("STTY-SIZE-DONE")

      const sizes = await page.evaluate(() => {
        const rowsEl = document.querySelector<HTMLElement>(
          "[data-gharargah-terminal-panel] .xterm-rows",
        )
        if (!rowsEl) return null
        const text = rowsEl.textContent ?? ""
        const match = text.match(/(\d+)\s+(\d+)[\s\S]*STTY-SIZE-DONE/)
        if (!match) return null
        return {
          ptyRows: Number(match[1]),
          ptyCols: Number(match[2]),
          rowCount: rowsEl.querySelectorAll(":scope > div").length,
        }
      })
      expect(sizes).toBeTruthy()
      expect(sizes!.ptyCols).toBeGreaterThan(40)
      expect(sizes!.ptyRows).toBeGreaterThan(10)
      // Visible DomRenderer row count must match PTY rows (fit ↔ winsize).
      expect(sizes!.rowCount).toBe(sizes!.ptyRows)
    } finally {
      await app.close()
    }
  })

  test("hides the hardware cursor after CSI ?25l (TUI park)", async () => {
    const { app, page } = await launchJet()
    try {
      await showTerminal(page)
      await focusTerminal(page)

      const ptyId = await page
        .locator("[data-gharargah-terminal-panel]")
        .getAttribute("data-gharargah-terminal-pty-id")
      expect(ptyId).toBeTruthy()

      // Park caret on last row then hide — Cursor Agent pattern (fake UI caret elsewhere).
      // sleep keeps the shell from redrawing a prompt (which often sends ?25h).
      await page.evaluate(async id => {
        const terminal = window.gharargah?.terminal
        if (!terminal) throw new Error("Terminal API unavailable")
        await terminal.write(
          id,
          "printf '\\033[2J\\033[HUI-CARET\\033[999;1H\\033[?25lCURSOR-HIDE-DONE\\n'; sleep 8\n",
        )
      }, ptyId!)

      await expect
        .poll(async () => readTerminalText(page), { timeout: 10_000 })
        .toContain("CURSOR-HIDE-DONE")

      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const panel = document.querySelector<HTMLElement>(
                "[data-gharargah-terminal-panel]",
              )
              return panel?.dataset.gharargahTerminalCursorHidden === "1"
            }),
          { timeout: 5_000 },
        )
        .toBe(true)

      const visibleHardwareCaret = await page.evaluate(() => {
        const cursors = [
          ...document.querySelectorAll<HTMLElement>(
            "[data-gharargah-terminal-panel] .xterm-cursor",
          ),
        ]
        return cursors.some(el => {
          const style = getComputedStyle(el)
          if (style.visibility === "hidden" || style.display === "none") return false
          if (Number.parseFloat(style.opacity || "1") < 0.05) return false
          // Bar caret uses inset box-shadow; block uses background.
          return (
            style.boxShadow !== "none" ||
            (style.backgroundColor !== "rgba(0, 0, 0, 0)" &&
              style.backgroundColor !== "transparent")
          )
        })
      })
      expect(visibleHardwareCaret).toBe(false)
    } finally {
      await app.close()
    }
  })

  test("updates tab label when shell emits OSC title sequence", async () => {
    const { app, page } = await launchJet()
    try {
      await showTerminal(page)

      await page.locator("[data-gharargah-terminal-panel] \.gharargah-terminal-surface").click()
      await page.evaluate(() => {
        const textarea = document.querySelector(
          "[data-gharargah-terminal-panel] .xterm-helper-textarea",
        ) as HTMLTextAreaElement | null
        textarea?.focus()
      })

      await page.waitForFunction(
        () => {
          const text = document.querySelector("[data-gharargah-terminal-panel] .xterm-rows")?.textContent ?? ""
          return text.trim().length > 0
        },
        null,
        { timeout: 15_000 },
      )

      await page.keyboard.type("echo -ne '\\033]0;JetTitleTest\\007'")
      await page.keyboard.press("Enter")

      await expectContainsText(page, "[data-gharargah-terminal-modal]", "JetTitleTest", {
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

      await page.locator("[data-gharargah-terminal-panel] \.gharargah-terminal-surface").click()
      await page.evaluate(() => {
        const textarea = document.querySelector(
          "[data-gharargah-terminal-panel] .xterm-helper-textarea",
        ) as HTMLTextAreaElement | null
        textarea?.focus()
      })

      await page.waitForFunction(
        () => {
          const text = document.querySelector("[data-gharargah-terminal-panel] .xterm-rows")?.textContent ?? ""
          return text.trim().length > 0
        },
        null,
        { timeout: 15_000 },
      )

      await page.keyboard.type("exit")
      await page.keyboard.press("Enter")

      await expectLocatorAttribute(page.locator("[data-gharargah-terminal-panel]"), 
        "data-gharargah-terminal-status",
        "exited",
        { timeout: 15_000 },
      )
      const exitBar = page.locator("[data-gharargah-terminal-exit-bar]")
      await expectLocatorVisible(exitBar, { timeout: 15_000 })
      await expectLocatorContainsText(exitBar, "Process exited")
      await expectLocatorVisible(exitBar.getByRole("button", { name: "Restart" }))
      await expectSelectorVisible(page, "[data-gharargah-terminal-panel] .xterm-rows")
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
          "[data-gharargah-terminal-panel] \.gharargah-terminal-surface",
        ) as HTMLElement | null
        const viewport = document.querySelector(
          "[data-gharargah-terminal-panel] .xterm-viewport",
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

  test("keeps one native terminal caret", async () => {
    const { app, page } = await launchJet()
    try {
      await showTerminal(page)
      const panel = page.locator("[data-gharargah-terminal-panel]")
      await expectLocatorAttribute(panel, "data-gharargah-terminal-status", "running")

      await expectLocatorCount(panel.locator("[data-gharargah-terminal-cursor-trail]"), 0)
      await expectLocatorCount(panel.locator(".xterm-cursor"), 1)

      await panel.locator(".gharargah-terminal-surface").click()
      await page.keyboard.type("cursor")
      await expectLocatorCount(panel.locator(".xterm-cursor"), 1)
      await expectLocatorCount(panel.locator("[data-gharargah-terminal-cursor-ghost]"), 0)
    } finally {
      await app.close()
    }
  })

  test("cursor stays inside xterm screen after modal close and reopen", async () => {
    const { app, page } = await launchJet()
    try {
      await showTerminal(page)
      const panel = page.locator("[data-gharargah-terminal-panel]")
      await expectLocatorAttribute(panel, "data-gharargah-terminal-status", "running")
      await expectLocatorCount(panel.locator(".xterm-cursor"), 1)

      await page.locator("[data-gharargah-terminal-modal-close]").click()
      await expectLocatorCount(page.locator("[data-gharargah-terminal-modal]"), 0)
      await expectSelectorVisible(page, "[data-gharargah-home], [data-gharargah-mission-sidebar]")

      await page.locator("[data-gharargah-terminal-card]:not([data-gharargah-new-session])").first().click()
      await expectSelectorVisible(page, "[data-gharargah-terminal-modal]")
      await expectLocatorAttribute(panel, "data-gharargah-terminal-status", "running")

      await page.waitForFunction(() => {
        const screen = document.querySelector<HTMLElement>(
          "[data-gharargah-terminal-panel] .xterm-screen",
        )
        const cursor = document.querySelector<HTMLElement>(
          "[data-gharargah-terminal-panel] .xterm-cursor",
        )
        if (!screen || !cursor) return false
        const opacity = Number.parseFloat(getComputedStyle(cursor).opacity || "1")
        if (opacity < 0.1) return false
        const screenRect = screen.getBoundingClientRect()
        const cursorRect = cursor.getBoundingClientRect()
        if (screenRect.width < 8 || screenRect.height < 8 || cursorRect.width < 1) return false
        return (
          cursorRect.left >= screenRect.left - 1 &&
          cursorRect.top >= screenRect.top - 1 &&
          cursorRect.right <= screenRect.right + 1 &&
          cursorRect.bottom <= screenRect.bottom + 1
        )
      })

      const box = await page.evaluate(() => {
        const screen = document.querySelector<HTMLElement>(
          "[data-gharargah-terminal-panel] .xterm-screen",
        )!
        const cursor = document.querySelector<HTMLElement>(
          "[data-gharargah-terminal-panel] .xterm-cursor",
        )!
        const screenRect = screen.getBoundingClientRect()
        const cursorRect = cursor.getBoundingClientRect()
        return {
          cursorTop: cursorRect.top - screenRect.top,
          cursorLeft: cursorRect.left - screenRect.left,
          screenHeight: screenRect.height,
          screenWidth: screenRect.width,
        }
      })
      expect(box.cursorTop).toBeGreaterThanOrEqual(0)
      expect(box.cursorTop).toBeLessThan(box.screenHeight)
      expect(box.cursorLeft).toBeGreaterThanOrEqual(0)
      expect(box.cursorLeft).toBeLessThan(box.screenWidth)
    } finally {
      await app.close()
    }
  })

  test("Escape is written to the active terminal instead of closing its session", async () => {
    const { app, page } = await launchJet()
    try {
      await showTerminal(page)
      await focusTerminal(page)
      await page.evaluate(() => {
        const terminal = window.gharargah?.terminal
        if (!terminal) throw new Error("Terminal API unavailable")
        const target = window as Window & { __terminalEscapeWrites?: string[] }
        target.__terminalEscapeWrites = []
        const write = terminal.write.bind(terminal)
        terminal.write = async (ptyId, data) => {
          target.__terminalEscapeWrites?.push(data)
          return write(ptyId, data)
        }
      })

      await page.keyboard.press("Escape")

      await expectSelectorVisible(page, "[data-gharargah-terminal-modal]")
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (
                window as Window & {
                  __terminalEscapeWrites?: string[]
                }
              ).__terminalEscapeWrites?.filter(data => data === "\u001b")
                .length ?? 0,
          ),
        )
        .toBe(1)

      // The Terminal tool owns Escape even if a chrome control temporarily
      // holds focus; route the byte to the visible PTY and restore xterm focus.
      await page.locator("[data-gharargah-terminal-modal-close]").focus()
      await page.keyboard.press("Escape")
      await expectSelectorVisible(page, "[data-gharargah-terminal-modal]")
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (
                window as Window & {
                  __terminalEscapeWrites?: string[]
                }
              ).__terminalEscapeWrites?.filter(data => data === "\u001b")
                .length ?? 0,
          ),
        )
        .toBe(2)
      await expectLocatorFocused(
        page.locator(
          "[data-gharargah-terminal-panel] .xterm-helper-textarea",
        ),
      )
    } finally {
      await app.close()
    }
  })

  test("Shift+Enter sends LF to the PTY for multiline CLI input", async () => {
    const { app, page } = await launchJet()
    try {
      await showTerminal(page)

      await page.locator("[data-gharargah-terminal-panel] \.gharargah-terminal-surface").click()
      await page.evaluate(() => {
        const textarea = document.querySelector(
          "[data-gharargah-terminal-panel] .xterm-helper-textarea",
        ) as HTMLTextAreaElement | null
        textarea?.focus()
      })

      await page.waitForFunction(
        () => {
          const text = document.querySelector("[data-gharargah-terminal-panel] .xterm-rows")?.textContent ?? ""
          return text.trim().length > 0
        },
        null,
        { timeout: 15_000 },
      )

      const written = await page.evaluate(async () => {
        const terminal = window.gharargah?.terminal
        if (!terminal) throw new Error("Terminal API unavailable")
        const chunks: string[] = []
        const original = terminal.write.bind(terminal)
        ;(terminal as { write: typeof original }).write = async (id: string, data: string) => {
          chunks.push(data)
          return original(id, data)
        }
        ;(window as unknown as { __gharargahTermWriteChunks?: string[] }).__gharargahTermWriteChunks = chunks
        ;(window as unknown as { __gharargahTermWriteRestore?: () => void }).__gharargahTermWriteRestore = () => {
          terminal.write = original
        }
        return null
      })

      expect(written).toBeNull()

      await page.keyboard.press("Shift+Enter")
      await page.waitForTimeout(100)

      const bytes = await page.evaluate(() => {
        const chunks = (window as unknown as { __gharargahTermWriteChunks?: string[] }).__gharargahTermWriteChunks ?? []
        ;(window as unknown as { __gharargahTermWriteRestore?: () => void }).__gharargahTermWriteRestore?.()
        return chunks.join("")
      })

      expect(bytes).toContain("\n")
      expect(bytes).not.toContain("\r")
    } finally {
      await app.close()
    }
  })

  test("maps macOS terminal navigation keys to readline input", async () => {
    const { app, page } = await launchJet()
    try {
      await showTerminal(page)
      await focusTerminal(page)
      await page.evaluate(() => {
        const terminal = window.gharargah?.terminal
        if (!terminal) throw new Error("Terminal API unavailable")
        const target = window as Window & { __terminalNavigationWrites?: string[] }
        target.__terminalNavigationWrites = []
        const original = terminal.write.bind(terminal)
        terminal.write = async (ptyId, data) => {
          target.__terminalNavigationWrites?.push(data)
          return original(ptyId, data)
        }
      })

      await page.keyboard.press("Alt+ArrowLeft")
      await page.keyboard.press("Meta+ArrowRight")
      await page.keyboard.press("Meta+Backspace")

      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (
                window as Window & {
                  __terminalNavigationWrites?: string[]
                }
              ).__terminalNavigationWrites?.join("") ?? "",
          ),
        )
        .toContain("\u001bb\u0005\u0015")
    } finally {
      await app.close()
    }
  })

  test("uses RAD smooth scrolling for terminal scrollback", async () => {
    const { app, page } = await launchJet()
    try {
      await showTerminal(page)
      const surface = page.locator("[data-gharargah-terminal-panel] \.gharargah-terminal-surface")
      await surface.click()
      await page.keyboard.type("seq 1 240")
      await page.keyboard.press("Enter")
      await page.waitForFunction(() => {
        const viewport = document.querySelector<HTMLElement>("[data-gharargah-terminal-panel] .xterm-viewport")
        return viewport != null && viewport.scrollHeight > viewport.clientHeight * 2
      }, null, { timeout: 15_000 })

      const samples = await page.locator("[data-gharargah-terminal-panel] .xterm-viewport").evaluate(async viewport => {
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
        const jumped = await page.locator("[data-gharargah-terminal-panel] .xterm-viewport").evaluate(viewport => {
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

  test("inserts shell-quoted dropped file paths into the PTY", async () => {
    const { app, page } = await launchJet()
    try {
      await showTerminal(page)
      await focusTerminal(page)
      const needle = "gharargah-drop-path-fixture"
      const dropped = await page.evaluate(async pathNeedle => {
        const path = `/tmp/${pathNeedle} with spaces.txt`
        const ok = await window.__gharargahAgent!.dropFilesOnTerminal([path])
        return { ok, path }
      }, needle)
      expect(dropped.ok).toBe(true)
      await expect
        .poll(async () => readTerminalText(page), { timeout: 10_000 })
        .toContain(needle)
      const text = await readTerminalText(page)
      expect(text).toContain("'")
      expect(text).toContain("with spaces")
    } finally {
      await app.close()
    }
  })
})
