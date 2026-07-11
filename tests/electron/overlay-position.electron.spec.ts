import { expect, test } from "@playwright/test"
import {
  expectLocatorFocused,
  expectLocatorVisible,
} from "../shell/assert.js"

import { execCommand, launchJet } from "./_launch.js"
import { expectPaletteOpen } from "../helpers/shell.js"

test.describe("overlay position stability", () => {
  async function openPalette(page: Parameters<typeof execCommand>[0]) {
    for (let attempt = 0; attempt < 3; attempt++) {
      await execCommand(page, "ui.showCommandPalette")
      try {
        await page.getByRole("dialog").waitFor({ state: "visible", timeout: 3_000 })
        return
      } catch {
        // Lazy overlay chunk can still be resolving on a cold native webview.
      }
    }
    throw new Error("command palette did not become visible")
  }

  test("command palette opens centered without upward jump", async () => {
    const { app, page } = await launchJet()
    try {
      await openPalette(page)
      await expectPaletteOpen(page)

      const dialog = page.locator("[data-slot='dialog-content']").first()
      await expectLocatorVisible(dialog)

      const tops: number[] = []
      for (let i = 0; i < 12; i++) {
        tops.push(await dialog.evaluate(el => el.getBoundingClientRect().top))
        await page.waitForTimeout(16)
      }

      expect(Math.abs(tops[0]! - tops[tops.length - 1]!)).toBeLessThan(3)
      expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(3)

      const viewportHeight = await page.evaluate(() => window.innerHeight)
      const mid = viewportHeight / 2
      const centerY = await dialog.evaluate(el => {
        const r = el.getBoundingClientRect()
        return r.top + r.height / 2
      })
      expect(Math.abs(centerY - mid)).toBeLessThan(viewportHeight * 0.08)
    } finally {
      await app.close()
    }
  })

  test("overlay caret aligns with palette input from the first frames", async () => {
    const { app, page } = await launchJet()
    try {
      await openPalette(page)
      await expectPaletteOpen(page)

      const input = page.locator("[data-slot='command-input']")
      await expectLocatorFocused(input)

      const caret = page.locator("[data-jet-universal-cursor]").first()
      await expect
        .poll(async () => caret.evaluate(el => parseFloat(el.style.opacity || "0")), {
          timeout: 3_000,
        })
        .toBeGreaterThan(0.2)

      const samples: { caretMid: number; inputTop: number; delta: number }[] = []
      for (let i = 0; i < 14; i++) {
        samples.push(
          await page.evaluate(() => {
            const inputEl = document.querySelector<HTMLElement>("[data-slot='command-input']")
            const caretEl = document.querySelector<HTMLElement>("[data-jet-universal-cursor]")
            if (!inputEl || !caretEl) return { caretMid: 0, inputTop: 0, delta: 999 }
            const ir = inputEl.getBoundingClientRect()
            const cr = caretEl.getBoundingClientRect()
            const inputMid = ir.top + ir.height / 2
            const caretMid = cr.top + cr.height / 2
            return { caretMid, inputTop: ir.top, delta: Math.abs(caretMid - inputMid) }
          }),
        )
        await page.waitForTimeout(16)
      }

      const inputTops = samples.map(s => s.inputTop)
      expect(Math.max(...inputTops) - Math.min(...inputTops)).toBeLessThan(2)

      const mids = samples.map(s => s.caretMid)
      expect(Math.max(...mids) - Math.min(...mids)).toBeLessThan(2)

      for (const sample of samples) {
        expect(sample.delta).toBeLessThan(6)
      }
    } finally {
      await app.close()
    }
  })
})
