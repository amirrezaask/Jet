import { expect, test } from "@playwright/test"

import {
  expectLocatorAttribute,
  expectLocatorCount,
  expectLocatorVisible,
  expectSelectorVisible,
} from "../shell/assert.js"
import { execCommand, hasPtySpawn, launchJet } from "./_launch.js"

function observeGhosts(
  selector: string,
  markerAttribute: string,
): string {
  return `(() => {
    const layer = document.querySelector(${JSON.stringify(selector)})
    if (!layer) throw new Error("Cursor trail layer is missing")
    const mark = () => {
      const visible = [...layer.children].some(child =>
        Number.parseFloat(child.style.opacity || "0") > 0.02
      )
      if (!visible) return
      layer.setAttribute(${JSON.stringify(markerAttribute)}, "true")
      observer.disconnect()
    }
    const observer = new MutationObserver(mark)
    observer.observe(layer, {
      subtree: true,
      attributes: true,
      attributeFilter: ["style"],
    })
    mark()
  })()`
}

test.describe("cursor ghost trails", () => {
  test("uses one bounded compositor trail for regular text inputs", async () => {
    const { app, page } = await launchJet()
    try {
      const input = page.getByLabel("Search projects and sessions")
      await expectLocatorVisible(input)
      const layer = page.locator("[data-jet-universal-caret-layer]")
      await expectLocatorVisible(layer)
      await expectLocatorCount(layer.locator("[data-jet-universal-cursor]"), 1)
      await expectLocatorCount(layer.locator("[data-jet-universal-cursor-ghost]"), 5)

      await page.evaluate(observeGhosts(
        "[data-jet-universal-caret-layer]",
        "data-gharargah-ghost-observed",
      ))
      await input.fill("jet")
      await expectLocatorAttribute(
        layer,
        "data-gharargah-ghost-observed",
        "true",
        { timeout: 5_000 },
      )

      const properties = await layer
        .locator("[data-jet-universal-cursor-ghost]")
        .first()
        .evaluate(element => {
          const style = element.style
          return {
            willChange: style.willChange,
            animationCount: element.getAnimations().length,
          }
        })
      expect(properties.willChange).toBe("transform, opacity")
      expect(properties.animationCount).toBeLessThanOrEqual(1)
    } finally {
      await app.close()
    }
  })

  test("adds ghost-only trails to Monaco and disables them for reduced motion", async () => {
    test.skip(!hasPtySpawn(), "PTY support is required to open an editor session")
    const { app, page } = await launchJet()
    try {
      await execCommand(page, "terminal.new")
      await expectSelectorVisible(page, "[data-gharargah-terminal-modal]", {
        timeout: 20_000,
      })
      await page.locator('[data-gharargah-session-mode-tab="editor"]').click()
      await page.evaluate(() => window.__gharargahAgent!.openFile("src/index.ts"))
      await expectSelectorVisible(page, "[data-gharargah-monaco-editor]", {
        timeout: 20_000,
      })

      const trail = page.locator("[data-gharargah-monaco-cursor-trail]")
      await expectLocatorVisible(trail)
      await expectLocatorCount(trail.locator("[data-gharargah-monaco-cursor-ghost]"), 5)
      await expectLocatorCount(trail.locator("[data-gharargah-monaco-cursor]"), 0)
      await page.evaluate(observeGhosts(
        "[data-gharargah-monaco-cursor-trail]",
        "data-gharargah-ghost-observed",
      ))

      const inputArea = page.locator("[data-gharargah-monaco-editor] textarea.inputarea")
      await inputArea.focus()
      await page.keyboard.type("x")
      await expectLocatorAttribute(
        trail,
        "data-gharargah-ghost-observed",
        "true",
        { timeout: 5_000 },
      )

      await page.evaluate(() => {
        document.documentElement.dataset.jetReducedMotion = "true"
      })
      await page.keyboard.type("y")
      await expect
        .poll(() =>
          trail.locator("[data-gharargah-monaco-cursor-ghost]").evaluateAll(elements =>
            elements.every(element => element.style.opacity === "0"),
          ),
        )
        .toBe(true)
    } finally {
      await app.close()
    }
  })
})
