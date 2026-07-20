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
} from "../shell/assert.js"

import { launchJet, openFixtureFile } from "./_launch.js"

test.describe("premium editor motion", () => {
  test("keeps the overlay caret inside its input throughout portal entrance", async () => {
    const { app, page } = await launchJet()
    try {
      await page.evaluate(() => {
        const layer = document.querySelector<HTMLElement>("[data-gharargah-universal-caret-layer]")
        if (!layer) throw new Error("universal caret layer missing")
        const inspect = () => {
          const cursor = layer.querySelector<HTMLElement>("[data-gharargah-universal-cursor]")
          const input = document.activeElement
          if (!cursor || !(input instanceof HTMLInputElement)) return
          if (parseFloat(cursor.style.opacity || "0") < 0.1) return
          const caret = cursor.getBoundingClientRect()
          const field = input.getBoundingClientRect()
          if (
            caret.left < field.left - 2 || caret.right > field.right + 2 ||
            caret.top < field.top - 2 || caret.bottom > field.bottom + 2
          ) layer.dataset.jetInvalidCaretFrame = "true"
        }
        new MutationObserver(inspect).observe(layer, {
          subtree: true,
          attributes: true,
          attributeFilter: ["style"],
        })
      })

      await page.evaluate(async () => window.__gharargahAgent!.executeCommand("ui.showCommandPalette"))
      const input = page.getByRole("dialog").getByRole("combobox")
      await expectLocatorFocused(input)
      await expect.poll(() => page.evaluate(() => {
        const cursor = document.querySelector<HTMLElement>("[data-gharargah-universal-cursor]")
        const field = document.activeElement
        if (!cursor || !(field instanceof HTMLInputElement)) return false
        const caret = cursor.getBoundingClientRect()
        const rect = field.getBoundingClientRect()
        return caret.left >= rect.left - 2 && caret.right <= rect.right + 2 &&
          caret.top >= rect.top - 2 && caret.bottom <= rect.bottom + 2
      })).toBe(true)
      expect(await page.evaluate(() =>
        document.querySelector("[data-gharargah-universal-caret-layer]")
          ?.getAttribute("data-gharargah-invalid-caret-frame") ?? null,
      )).toBeNull()
    } finally {
      await app.close()
    }
  })

  test("uses the shared ghost caret across palette and form inputs", async () => {
    const { app, page } = await launchJet()
    try {
      await page.evaluate(() => {
        document.documentElement.dataset.jetReducedMotion = "false"
      })
      await page.evaluate(async () => window.__gharargahAgent!.executeCommand("ui.showCommandPalette"))
      const paletteInput = page.locator("[data-slot='command-input']")
      await expectLocatorFocused(paletteInput)
      await expectLocatorAttached(page.locator("[data-gharargah-universal-caret-layer]"))
      await expectLocatorCount(page.locator("[data-gharargah-universal-cursor]"), 1)
      await expectLocatorCount(page.locator("[data-gharargah-universal-cursor-ghost]"), 5)
      await expectLocatorCount(page.locator("[data-gharargah-caret-measure-mirror]"), 1)
      await expect
        .poll(() => paletteInput.evaluate(element => getComputedStyle(element).caretColor))
        .toBe("rgba(0, 0, 0, 0)")

      await page.evaluate(() => {
        const layer = document.querySelector<HTMLElement>("[data-gharargah-universal-caret-layer]")
        if (!layer) return
        const observer = new MutationObserver(() => {
          const visible = [...layer.querySelectorAll<HTMLElement>("[data-gharargah-universal-cursor-ghost]")]
            .some(ghost => parseFloat(ghost.style.opacity || "0") > 0.02)
          if (!visible) return
          layer.dataset.jetGhostObserved = "true"
          observer.disconnect()
        })
        observer.observe(layer, { subtree: true, attributes: true, attributeFilter: ["style"] })
        window.setTimeout(() => observer.disconnect(), 1_000)
      })
      await page.keyboard.type("open")
      await expectLocatorCount(page.locator("[data-gharargah-caret-measure-mirror]"), 1)
      await expectLocatorAttribute(page.locator("[data-gharargah-universal-caret-layer]"), 
        "data-gharargah-ghost-observed",
        "true",
        { timeout: 5_000 },
      )

      await page.keyboard.press("Escape")
      await page.evaluate(async () => window.__gharargahAgent!.executeCommand("settings.show"))
      const numberInput = page.locator("[data-gharargah-settings-overlay] input[type='number']").first()
      await numberInput.focus()
      await expect
        .poll(() => numberInput.evaluate(element => getComputedStyle(element).caretColor))
        .toBe("rgba(0, 0, 0, 0)")
      await expectSelectorVisible(page, "[data-gharargah-universal-cursor]")

      await page.keyboard.press("Escape")
      await expectSelectorHidden(page, "[data-gharargah-settings-overlay]")
      await page.evaluate(() => {
        const editable = document.createElement("div")
        editable.contentEditable = "true"
        editable.dataset.jetTestEditable = ""
        editable.textContent = "prompt"
        Object.assign(editable.style, { position: "fixed", left: "20px", top: "20px" })
        document.querySelector("[data-gharargah-app-shell]")?.appendChild(editable)
        const range = document.createRange()
        range.selectNodeContents(editable)
        range.collapse(false)
        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
        editable.focus()
      })
      const editable = page.locator("[data-gharargah-test-editable]")
      await expect
        .poll(() => editable.evaluate(element => getComputedStyle(element).caretColor))
        .toBe("rgba(0, 0, 0, 0)")
      await expectSelectorVisible(page, "[data-gharargah-universal-cursor]")

    } finally {
      await app.close()
    }
  })

  test("keeps daily palettes instant while standard dialogs retain restrained motion", async () => {
    const { app, page } = await launchJet()
    try {
      await page.evaluate(() => {
        document.documentElement.dataset.jetReducedMotion = "false"
      })
      await page.evaluate(async () => window.__gharargahAgent!.executeCommand("ui.showCommandPalette"))
      const palette = page.locator("[data-slot='dialog-content']").first()
      await expectLocatorVisible(palette)
      expect(await palette.evaluate(element => element.getAttribute("data-gharargah-dialog-motion"))).toBe("instant")
      expect(await palette.evaluate(element => element.getAttribute("data-gharargah-dialog-size"))).toBe("picker")
      expect(await palette.evaluate(element => getComputedStyle(element).animationName)).toBe("none")

      await page.keyboard.press("Escape")
      await page.evaluate(async () => window.__gharargahAgent!.executeCommand("settings.show"))
      const settings = page.locator("[data-gharargah-settings-overlay]")
      await expectLocatorVisible(settings)
      expect(await settings.evaluate(element => element.getAttribute("data-gharargah-dialog-motion"))).toBe("standard")
      expect(await settings.evaluate(element => getComputedStyle(element).animationDuration)).toBe("0.18s")

      await page.keyboard.press("Escape")
      await page.evaluate(() => {
        document.documentElement.dataset.jetReducedMotion = "true"
      })
      await page.evaluate(async () => window.__gharargahAgent!.executeCommand("settings.show"))
      const reducedSettings = page.locator("[data-gharargah-settings-overlay]")
      await expectLocatorVisible(reducedSettings)
      expect(await reducedSettings.evaluate(element => getComputedStyle(element).animationName))
        .toBe("gharargah-overlay-enter")
      expect(await reducedSettings.evaluate(element => getComputedStyle(element).animationDuration))
        .toBe("0.12s")
      expect(await reducedSettings.evaluate(element => getComputedStyle(element).transform)).toBe("none")
    } finally {
      await app.close()
    }
  })

  test("shows native autocomplete and a shared motion cursor", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/index.ts")
      await expectSelectorVisible(page, "[data-gharargah-editor-cursor-layer]")
      await page.locator(".cm-content").focus()
      await expectLocatorCount(page.locator("[data-gharargah-editor-cursor]"), 1)

      await page.keyboard.press("Control+Space")
      const completion = page.locator(".cm-tooltip.cm-tooltip-autocomplete")
      await expectLocatorVisible(completion)
      await expect.poll(() => completion.locator("li").count()).toBeGreaterThan(0)
      await expectLocatorCount(completion.locator("li[aria-selected]"), 1, { timeout: 5_000 })

      await page.keyboard.press("Escape")
      await page.evaluate(() => window.__gharargahAgent!.setEditorSelection(1, 1))
      await page.locator(".cm-content").focus()
      await page.evaluate(() => {
        const layer = document.querySelector<HTMLElement>("[data-gharargah-editor-cursor-layer]")
        if (!layer) return
        const observer = new MutationObserver(() => {
          const visible = [...layer.querySelectorAll<HTMLElement>("[data-gharargah-editor-cursor-ghost]")]
            .some(ghost => parseFloat(ghost.style.opacity || "0") > 0.02)
          if (!visible) return
          layer.dataset.jetGhostObserved = "true"
          observer.disconnect()
        })
        observer.observe(layer, { subtree: true, attributes: true, attributeFilter: ["style"] })
        window.setTimeout(() => observer.disconnect(), 1_000)
      })
      await page.keyboard.type("x")
      await expectLocatorAttribute(page.locator("[data-gharargah-editor-cursor-layer]"), 
        "data-gharargah-ghost-observed",
        "true",
        { timeout: 5_000 },
      )
    } finally {
      await app.close()
    }
  })

  test("smooth editor scroll converges through intermediate positions", async () => {
    const { app, page } = await launchJet(".")
    try {
      // Force motion on so headless OS "reduce" preference does not snap-scroll.
      await page.evaluate(() => {
        const original = window.matchMedia.bind(window)
        window.matchMedia = ((query: string) => {
          if (String(query).includes("prefers-reduced-motion")) {
            return {
              matches: false,
              media: query,
              onchange: null,
              addListener() {},
              removeListener() {},
              addEventListener() {},
              removeEventListener() {},
              dispatchEvent() {
                return false
              },
            } as MediaQueryList
          }
          return original(query)
        }) as typeof window.matchMedia
      })
      await openFixtureFile(page, "packages/gharargah-app/src/App.tsx")
      await page.locator(".cm-scroller").evaluate(scroller => {
        if (!("jetSmoothScroll" in scroller.dataset)) {
          throw new Error("smooth scroll plugin not attached")
        }
        scroller.scrollTop = 0
        scroller.dispatchEvent(
          new WheelEvent("wheel", {
            deltaY: 720,
            deltaMode: WheelEvent.DOM_DELTA_PIXEL,
            bubbles: true,
            cancelable: true,
          }),
        )
      })
      // Sample from the host — long in-page async scripts time out under WebDriver,
      // and hidden/throttled webviews stall setTimeout loops.
      const samples: number[] = []
      for (let frame = 0; frame < 45; frame++) {
        await page.waitForTimeout(16)
        const sample = await page.locator(".cm-scroller").evaluate(scroller => ({
          top: scroller.scrollTop,
          active: scroller.dataset.jetScrollActive ?? "",
        }))
        samples.push(sample.top)
        if (sample.active === "false" && frame > 2) break
      }
      const moving = samples.filter((value, index) => index === 0 || value !== samples[index - 1])
      expect(moving.length).toBeGreaterThanOrEqual(3)
      expect(samples.at(-1)).toBeGreaterThan(300)
      expect(samples.every((value, index) => index === 0 || value >= samples[index - 1]!)).toBe(true)
    } finally {
      await app.close()
    }
  })
})
