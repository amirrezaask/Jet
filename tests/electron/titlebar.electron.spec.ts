import { _electron as electron, expect, test } from "@playwright/test"
import { resolve } from "node:path"

const REPO_ROOT = resolve(__dirname, "..", "..")
const DESKTOP_DIR = resolve(REPO_ROOT, "apps/jet-desktop")
const MAIN_JS = resolve(DESKTOP_DIR, "dist-electron/main.js")

const TRAFFIC_LIGHT_ZONE_PX = 78

test.describe("desktop shell", () => {
  test.skip(process.platform !== "darwin", "traffic lights are macOS-only")

  test("titlebar menubar clears the traffic-light zone", async () => {
    const app = await electron.launch({
      args: [MAIN_JS],
      cwd: DESKTOP_DIR,
      env: { ...process.env, JET_E2E: "1" },
    })
    try {
      const win = await app.firstWindow()
      await win.waitForLoadState("domcontentloaded")
      await win.waitForFunction(() => window.__jetAgent != null, null, { timeout: 30_000 })
      await win.evaluate(async () => {
        await window.__jetAgent!.waitForReady()
      })

      const bar = win.locator("[data-jet-titlebar]")
      await expect(bar).toBeVisible({ timeout: 10_000 })

      const geom = await win.evaluate(zone => {
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
      }, TRAFFIC_LIGHT_ZONE_PX)

      expect(geom, "titlebar element must exist in Electron shell").not.toBeNull()
      expect(geom!.spacerRight, "traffic-light spacer must render").not.toBeNull()
      expect(geom!.spacerRight!).toBeGreaterThanOrEqual(TRAFFIC_LIGHT_ZONE_PX)
      expect(geom!.minMenuLeft, "at least one menu trigger must render").not.toBeNull()
      expect(
        geom!.minMenuLeft!,
        `first menu item left=${geom!.minMenuLeft} overlaps traffic-light zone (${TRAFFIC_LIGHT_ZONE_PX}px)`,
      ).toBeGreaterThanOrEqual(TRAFFIC_LIGHT_ZONE_PX)
    } finally {
      await app.close()
    }
  })
})

