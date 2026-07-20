import { expect, test } from "@playwright/test"
import { expectLocatorVisible, expectSelectorVisible } from "../shell/assert.js"
import { launchJet } from "./_launch.js"

test.describe("desktop shell", () => {
  test.skip(process.platform !== "darwin", "traffic lights are macOS-only")

  test("home titlebar clears traffic lights without Home control or wordmark", async () => {
    const { app, page } = await launchJet()
    try {
      await expectSelectorVisible(page, "[data-gharargah-home]")
      const titlebar = page.locator("[data-gharargah-titlebar]")
      await expectLocatorVisible(titlebar)

      const geom = await page.evaluate(() => {
        const root = document.documentElement
        const insetRaw = getComputedStyle(root).getPropertyValue("--gharargah-traffic-light-inset").trim()
        const probe = document.createElement("div")
        probe.style.width = insetRaw || "5rem"
        document.body.appendChild(probe)
        const zone = probe.getBoundingClientRect().width
        probe.remove()

        const bar = document.querySelector<HTMLElement>("[data-gharargah-titlebar]")
        if (!bar) return null
        const style = getComputedStyle(bar)
        return {
          paddingLeft: parseFloat(style.paddingLeft),
          zone,
          hasHome: document.querySelector("[data-gharargah-home-button]") != null,
          hasSidebar: document.querySelector("[data-gharargah-workspace-sidebar]") != null,
          wordmark: (bar.textContent ?? "").trim(),
        }
      })

      expect(geom, "home titlebar must exist").not.toBeNull()
      expect(geom!.hasHome).toBe(false)
      expect(geom!.hasSidebar).toBe(false)
      expect(geom!.paddingLeft).toBeGreaterThanOrEqual(geom!.zone - 1)
      expect(geom!.wordmark).not.toMatch(/Gharargah/i)
      expect(geom!.wordmark).not.toMatch(/Home/i)
    } finally {
      await app.close()
    }
  })
})
