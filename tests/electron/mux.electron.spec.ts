import { expect, test } from "@playwright/test"
import {
  expectLocatorVisible,
  expectSelectorVisible,
} from "../shell/assert.js"
import {
  execCommand,
  launchJet,
  waitForMux,
} from "./_launch.js"

test.describe("mux tabs", () => {
  test("boots with vertical tab strip and one window", async () => {
    const { app, page } = await launchJet()
    try {
      await waitForMux(page)
      await expectSelectorVisible(page, "[data-yaade-mux][data-orientation=vertical]")
      await expectSelectorVisible(page, "[data-yaade-mux-tab-strip]")
      await expect
        .poll(async () => page.locator("[data-yaade-mux-tab]").count())
        .toBeGreaterThanOrEqual(1)
      await expectSelectorVisible(page, "[data-yaade-mux-window]")
      await expectSelectorVisible(page, "[data-yaade-terminal-panel]")
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
        "[data-yaade-mux][data-orientation=vertical]",
      )
      await execCommand(page, "mux.toggleTabOrientation")
      await expectSelectorVisible(
        page,
        "[data-yaade-mux][data-orientation=horizontal]",
      )
      await execCommand(page, "mux.toggleTabOrientation")
      await expectSelectorVisible(
        page,
        "[data-yaade-mux][data-orientation=vertical]",
      )
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
})

test.describe("mux switcher", () => {
  test("command palette opens via Mod-Shift-p", async () => {
    const { app, page } = await launchJet()
    try {
      await waitForMux(page)

      await page.locator("[data-yaade-mux-pane]").first().click()
      await page.keyboard.press("Meta+Shift+KeyP")
      await expect
        .poll(async () => page.locator("[data-yaade-palette]").count(), {
          timeout: 10_000,
        })
        .toBeGreaterThan(0)
      await expectSelectorVisible(page, "[data-yaade-palette]")

      await page.keyboard.press("Escape")
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