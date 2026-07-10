import { expect, test } from "@playwright/test"
import { launchJet, openFixtureFile } from "./_launch.js"

test.describe("premium editor motion", () => {
  test("uses the shared ghost caret across palette and form inputs", async () => {
    const { app, page } = await launchJet()
    try {
      await page.evaluate(async () => window.__jetAgent!.executeCommand("ui.showCommandPalette"))
      const paletteInput = page.locator("[data-slot='command-input']")
      await expect(paletteInput).toBeFocused()
      await expect(page.locator("[data-jet-universal-caret-layer]")).toBeAttached()
      await expect(page.locator("[data-jet-universal-cursor]")).toHaveCount(1)
      await expect(page.locator("[data-jet-universal-cursor-ghost]")).toHaveCount(5)
      await expect
        .poll(() => paletteInput.evaluate(element => getComputedStyle(element).caretColor))
        .toBe("rgba(0, 0, 0, 0)")

      await page.evaluate(() => {
        const layer = document.querySelector<HTMLElement>("[data-jet-universal-caret-layer]")
        if (!layer) return
        const observer = new MutationObserver(() => {
          const visible = [...layer.querySelectorAll<HTMLElement>("[data-jet-universal-cursor-ghost]")]
            .some(ghost => parseFloat(ghost.style.opacity || "0") > 0.02)
          if (!visible) return
          layer.dataset.jetGhostObserved = "true"
          observer.disconnect()
        })
        observer.observe(layer, { subtree: true, attributes: true, attributeFilter: ["style"] })
        window.setTimeout(() => observer.disconnect(), 1_000)
      })
      await page.keyboard.type("open")
      await expect(page.locator("[data-jet-universal-caret-layer]")).toHaveAttribute(
        "data-jet-ghost-observed",
        "true",
        { timeout: 1_000 },
      )

      await page.keyboard.press("Escape")
      await page.evaluate(async () => window.__jetAgent!.executeCommand("settings.show"))
      const numberInput = page.locator("[data-jet-settings-overlay] input[type='number']").first()
      await numberInput.focus()
      await expect
        .poll(() => numberInput.evaluate(element => getComputedStyle(element).caretColor))
        .toBe("rgba(0, 0, 0, 0)")
      await expect(page.locator("[data-jet-universal-cursor]")).toBeVisible()

      await page.keyboard.press("Escape")
      await expect(page.locator("[data-jet-settings-overlay]")).toBeHidden()
      await page.evaluate(() => {
        const editable = document.createElement("div")
        editable.contentEditable = "true"
        editable.dataset.jetTestEditable = ""
        editable.textContent = "prompt"
        Object.assign(editable.style, { position: "fixed", left: "20px", top: "20px" })
        document.querySelector("[data-jet-app-shell]")?.appendChild(editable)
        const range = document.createRange()
        range.selectNodeContents(editable)
        range.collapse(false)
        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
        editable.focus()
      })
      const editable = page.locator("[data-jet-test-editable]")
      await expect
        .poll(() => editable.evaluate(element => getComputedStyle(element).caretColor))
        .toBe("rgba(0, 0, 0, 0)")
      await expect(page.locator("[data-jet-universal-cursor]")).toBeVisible()

    } finally {
      await app.close()
    }
  })

  test("shows native autocomplete and a shared motion cursor", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/index.ts")
      await expect(page.locator("[data-jet-editor-cursor-layer]")).toBeVisible()
      await expect(page.locator("[data-jet-editor-cursor]")).toHaveCount(1)

      await page.keyboard.press("Control+Space")
      const completion = page.locator(".cm-tooltip.cm-tooltip-autocomplete")
      await expect(completion).toBeVisible()
      await expect(completion.locator("li")).not.toHaveCount(0)
      await expect(completion.locator("li[aria-selected]")).toHaveCount(1)

      await page.keyboard.press("Escape")
      await page.evaluate(() => window.__jetAgent!.setEditorSelection(1, 1))
      await page.locator(".cm-content").focus()
      await page.evaluate(() => {
        const layer = document.querySelector<HTMLElement>("[data-jet-editor-cursor-layer]")
        if (!layer) return
        const observer = new MutationObserver(() => {
          const visible = [...layer.querySelectorAll<HTMLElement>("[data-jet-editor-cursor-ghost]")]
            .some(ghost => parseFloat(ghost.style.opacity || "0") > 0.02)
          if (!visible) return
          layer.dataset.jetGhostObserved = "true"
          observer.disconnect()
        })
        observer.observe(layer, { subtree: true, attributes: true, attributeFilter: ["style"] })
        window.setTimeout(() => observer.disconnect(), 1_000)
      })
      await page.keyboard.press("ArrowDown")
      await expect(page.locator("[data-jet-editor-cursor-layer]")).toHaveAttribute(
        "data-jet-ghost-observed",
        "true",
        { timeout: 1_000 },
      )
    } finally {
      await app.close()
    }
  })

  test("smooth editor scroll converges through intermediate positions", async () => {
    const { app, page } = await launchJet(".")
    try {
      await openFixtureFile(page, "packages/jet-app/src/App.tsx")
      const samples = await page.locator(".cm-scroller").evaluate(async scroller => {
        scroller.scrollTop = 0
        scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: 720, bubbles: true, cancelable: true }))
        const values: number[] = []
        for (let frame = 0; frame < 30; frame++) {
          await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
          values.push(scroller.scrollTop)
          if (scroller.dataset.jetScrollActive === "false" && frame > 2) break
        }
        return values
      })
      const moving = samples.filter((value, index) => index === 0 || value !== samples[index - 1])
      expect(moving.length).toBeGreaterThanOrEqual(3)
      expect(samples.at(-1)).toBeGreaterThan(300)
      expect(samples.every((value, index) => index === 0 || value >= samples[index - 1]!)).toBe(true)
    } finally {
      await app.close()
    }
  })
})
