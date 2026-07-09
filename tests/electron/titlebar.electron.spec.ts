import { expect, test } from "@playwright/test"
import { skipFlakyTest } from "./_flaky.js"
import { launchJet } from "./_launch.js"

test.describe("desktop shell", () => {
  test.skip(process.platform !== "darwin", "traffic lights are macOS-only")

  test("titlebar menubar clears the traffic-light zone", async () => {
    const { app, page } = await launchJet()
    try {
      const bar = page.locator("[data-jet-titlebar]")
      await expect(bar).toBeVisible({ timeout: 10_000 })

      const geom = await page.evaluate(() => {
        const root = document.documentElement
        const insetRaw = getComputedStyle(root).getPropertyValue("--jet-traffic-light-inset").trim()
        const probe = document.createElement("div")
        probe.style.width = insetRaw || "7.7rem"
        document.body.appendChild(probe)
        const zone = probe.getBoundingClientRect().width
        probe.remove()

        const bar = document.querySelector<HTMLElement>("[data-jet-titlebar]")
        if (!bar) return null
        const spacer = document.querySelector<HTMLElement>("[data-jet-traffic-light-spacer]")
        const menuItems = Array.from(
          document.querySelectorAll<HTMLElement>(
            "[data-jet-titlebar] [role='menubar'] > *, [data-jet-titlebar] button, [data-jet-titlebar] [role='menuitem']",
          ),
        )
        const menuLefts = menuItems
          .map(el => el.getBoundingClientRect().left)
          .filter(l => Number.isFinite(l))
        return {
          barLeft: bar.getBoundingClientRect().left,
          spacerRight: spacer?.getBoundingClientRect().right ?? null,
          minMenuLeft: menuLefts.length ? Math.min(...menuLefts) : null,
          zone,
        }
      })

      expect(geom, "titlebar element must exist in Electron shell").not.toBeNull()
      expect(geom!.spacerRight, "traffic-light spacer must render").not.toBeNull()
      expect(geom!.spacerRight!).toBeGreaterThanOrEqual(geom!.zone)
      expect(geom!.minMenuLeft, "at least one menu trigger must render").not.toBeNull()
      expect(
        geom!.minMenuLeft!,
        `first menu item left=${geom!.minMenuLeft} overlaps traffic-light zone (${geom!.zone}px)`,
      ).toBeGreaterThanOrEqual(geom!.zone)
    } finally {
      await app.close()
    }
  })

  skipFlakyTest("titlebar View → Show Explorer menubar click timing")

  test("titlebar view menu opens explorer", async () => {
    const { app, page } = await launchJet()
    try {
      const bar = page.locator("[data-jet-titlebar]")
      await expect(bar).toBeVisible({ timeout: 10_000 })
      await bar.getByText("View", { exact: true }).click()
      await page.waitForTimeout(200)
      await page.getByText("Show Explorer", { exact: true }).click()
      await page.waitForTimeout(600)
      await expect(page.locator('[data-jet-list-panel="jet:explorer"]')).toBeVisible()
    } finally {
      await app.close()
    }
  })
})

