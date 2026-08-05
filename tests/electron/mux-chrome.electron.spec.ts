import { expect, test } from "@playwright/test"
import { expectSelectorVisible } from "../shell/assert.js"
import { execCommand, launchJet, waitForMux } from "./_launch.js"

/**
 * Mux-native chrome smoke tests. These assert the Compact Glass affordances that
 * must work for mouse/keyboard users without hover:
 *   - pane controls sit at a visible resting opacity (not opacity-0)
 *   - a persistent status strip anchors the shell footer
 *   - double-clicking pane chrome zooms once a split exists
 *
 * Some of these depend on MuxApp wiring (status strip, per-pane git action) and
 * may fail until that lands — they are written to the intended contract.
 */
test.describe("mux chrome", () => {
  test("pane controls are visible at rest (not opacity-0) without hover", async () => {
    const { app, page } = await launchJet()
    try {
      await waitForMux(page)
      await expectSelectorVisible(page, "[data-yaade-mux-pane-chrome]")

      // Close is always present; opacity must be a visible resting value.
      const closeBtn = page.locator("[data-yaade-mux-close-pane]").first()
      await closeBtn.waitFor({ state: "visible", timeout: 15_000 })
      await expect
        .poll(async () =>
          closeBtn.evaluate(el => Number(getComputedStyle(el).opacity)),
        )
        .toBeGreaterThan(0)

      // Open-git affordance, when present, must also rest visibly.
      const gitBtn = page.locator("[data-yaade-mux-open-git]").first()
      if ((await gitBtn.count()) > 0) {
        await gitBtn.waitFor({ state: "visible", timeout: 15_000 })
        await expect
          .poll(async () =>
            gitBtn.evaluate(el => Number(getComputedStyle(el).opacity)),
          )
          .toBeGreaterThan(0)
      }
    } finally {
      await app.close()
    }
  })

  test("a persistent status strip anchors the shell", async () => {
    const { app, page } = await launchJet()
    try {
      await waitForMux(page)
      await expectSelectorVisible(page, "[data-yaade-mux-status-strip]")
    } finally {
      await app.close()
    }
  })

  test("double-clicking pane chrome zooms when 2+ panes exist", async () => {
    const { app, page } = await launchJet()
    try {
      await waitForMux(page)
      await execCommand(page, "mux.splitRight")
      await expect
        .poll(async () => page.locator("[data-yaade-mux-pane]").count(), {
          timeout: 15_000,
        })
        .toBeGreaterThanOrEqual(2)

      const chrome = page.locator("[data-yaade-mux-pane-chrome]").first()
      await chrome.waitFor({ state: "visible", timeout: 15_000 })
      // The ShellDriver locator has no dblclick; dispatch a native dblclick on
      // the chrome root (target is the div, not a control button) so the React
      // onDoubleClick zoom handler fires.
      await chrome.evaluate(el =>
        el.dispatchEvent(
          new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
        ),
      )

      await expect
        .poll(
          async () =>
            page.locator("[data-yaade-mux-pane-chrome][data-zoomed]").count(),
          { timeout: 15_000 },
        )
        .toBeGreaterThan(0)
    } finally {
      await app.close()
    }
  })
})
