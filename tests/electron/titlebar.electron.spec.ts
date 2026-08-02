import { expect, test } from "@playwright/test"
import {
  expectLocatorCount,
  expectLocatorVisible,
  expectSelectorVisible,
} from "../shell/assert.js"
import { launchJet } from "./_launch.js"

test.describe("desktop shell", () => {
  test("uses draggable custom chrome with platform controls kept clear", async () => {
    const { app, page } = await launchJet()
    try {
      await expectSelectorVisible(page, "[data-gharargah-mission-sidebar]")
      // Browser mode stays layout-neutral; then emulate the immutable preload
      // metadata to exercise the shared renderer's Electron chrome.
      await expectLocatorCount(page.locator("[data-gharargah-titlebar]"), 0)
      await page.addInitScript(() => {
        const connection = {
          activeUrl: window.location.origin,
          localUrl: window.location.origin,
          mode: "local",
          startupError: null,
        }
        window.gharargahDesktop = Object.freeze({
          windowChrome: Object.freeze({
            customTitlebar: true,
            platform: "darwin",
            titlebarHeight: 40,
            trafficLights: true,
          }),
          getServerConnection: async () => connection,
          connectToServer: async () => connection,
        })
      })
      await page.reload({ waitUntil: "domcontentloaded" })
      await expectSelectorVisible(page, "[data-gharargah-mission-sidebar]")

      const titlebar = page.locator("[data-gharargah-titlebar]")
      await expectLocatorVisible(titlebar)
      await expectLocatorCount(titlebar, 1)
      await expectLocatorCount(page.locator("[data-gharargah-home-button]"), 0)

      const chrome = await page.evaluate(() => {
        const config = window.gharargahDesktop?.windowChrome
        const titlebarEl = document.querySelector(
          "[data-gharargah-titlebar]",
        )
        const rect = titlebarEl?.getBoundingClientRect()
        return {
          config,
          frozen: config ? Object.isFrozen(config) : false,
          dragRegion: titlebarEl
            ? getComputedStyle(titlebarEl).getPropertyValue(
                "-webkit-app-region",
              )
            : "",
          rect: rect
            ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
            : null,
        }
      })
      expect(chrome.config?.customTitlebar).toBe(true)
      expect(chrome.frozen).toBe(true)
      expect(chrome.dragRegion).toBe("drag")
      expect(chrome.rect?.y).toBe(0)
      expect(chrome.rect?.height).toBe(chrome.config?.titlebarHeight)

      if (chrome.config?.trafficLights) {
        const spacer = page.locator(
          "[data-gharargah-titlebar] [data-gharargah-traffic-light-spacer]",
        )
        await expectLocatorVisible(spacer)
        await expect
          .poll(async () => (await spacer.boundingBox())?.width ?? 0)
          .toBeGreaterThanOrEqual(64)
      } else {
        await expectLocatorVisible(
          page.locator(
            "[data-gharargah-titlebar] [data-gharargah-window-controls-spacer]",
          ),
        )
      }

      const sidebar = page.locator("[data-gharargah-mission-sidebar]")
      const sidebarSegment = page.locator(
        "[data-gharargah-titlebar-sidebar-segment]",
      )
      await expectLocatorVisible(sidebar)
      await expectLocatorVisible(sidebarSegment)
      await expect
        .poll(async () => {
          const [sidebarBox, segmentBox, barBox] = await Promise.all([
            sidebar.boundingBox(),
            sidebarSegment.boundingBox(),
            titlebar.boundingBox(),
          ])
          if (!sidebarBox || !segmentBox || !barBox) return null
          return {
            widthDelta: Math.abs(sidebarBox.width - segmentBox.width),
            sidebarTop: sidebarBox.y,
            titlebarBottom: barBox.y + barBox.height,
          }
        })
        .toEqual({
          widthDelta: 0,
          sidebarTop: chrome.config?.titlebarHeight,
          titlebarBottom: chrome.config?.titlebarHeight,
        })
    } finally {
      await app.close()
    }
  })
})
