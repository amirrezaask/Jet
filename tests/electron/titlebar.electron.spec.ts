import { expect, test } from "@playwright/test"
import {
  expectLocatorAttribute,
  expectLocatorVisible,
} from "../shell/assert.js"

import { expectListRows } from "../helpers/list.js"
import { execCommand, launchJet } from "./_launch.js"

test.describe("desktop shell", () => {
  test.skip(process.platform !== "darwin", "traffic lights are macOS-only")

  test("traffic lights live on the sidebar chrome surface", async () => {
    const { app, page } = await launchJet()
    try {
      const chrome = page.locator("[data-jet-sidebar-chrome]")
      await expectLocatorVisible(chrome, { timeout: 10_000 })

      const geom = await page.evaluate(() => {
        const root = document.documentElement
        const insetRaw = getComputedStyle(root).getPropertyValue("--jet-traffic-light-inset").trim()
        const probe = document.createElement("div")
        probe.style.width = insetRaw || "7.7rem"
        document.body.appendChild(probe)
        const zone = probe.getBoundingClientRect().width
        probe.remove()

        const sidebarChrome = document.querySelector<HTMLElement>("[data-jet-sidebar-chrome]")
        if (!sidebarChrome) return null
        const spacer = document.querySelector<HTMLElement>("[data-jet-traffic-light-spacer]")
        const workspaceSidebar = document.querySelector<HTMLElement>("[data-jet-workspace-sidebar]")
        const tabBarDrag = document.querySelector<HTMLElement>("[data-jet-tab-bar-drag]")
        if (!workspaceSidebar) return null
        const chromeRect = sidebarChrome.getBoundingClientRect()
        const workspaceSidebarRect = workspaceSidebar.getBoundingClientRect()
        return {
          spacerRight: spacer?.getBoundingClientRect().right ?? null,
          chromeLeft: chromeRect.left,
          chromeRight: chromeRect.right,
          chromeHeight: chromeRect.height,
          workspaceSidebarLeft: workspaceSidebarRect.left,
          workspaceSidebarRight: workspaceSidebarRect.right,
          chromeColor: getComputedStyle(sidebarChrome).backgroundColor,
          workspaceSidebarColor: getComputedStyle(workspaceSidebar).backgroundColor,
          hasMenubar: document.querySelector("[data-jet-sidebar-chrome] [role='menubar']") != null,
          hasTitlebar: document.querySelector("[data-jet-titlebar]") != null,
          tauriChromeDeepDrag: sidebarChrome.getAttribute("data-tauri-drag-region") === "deep",
          tauriSpacerDragRegion: spacer?.hasAttribute("data-tauri-drag-region") === true,
          tauriTabBarDrag: tabBarDrag?.getAttribute("data-tauri-drag-region") === "true",
          spacerHeight: spacer?.getBoundingClientRect().height ?? 0,
          zone,
        }
      })

      expect(geom, "sidebar chrome must exist in desktop shell").not.toBeNull()
      expect(geom!.hasTitlebar, "legacy titlebar must be removed").toBe(false)
      expect(geom!.spacerRight, "traffic-light spacer must render").not.toBeNull()
      expect(geom!.spacerRight!).toBeGreaterThanOrEqual(geom!.zone)
      expect(geom!.chromeLeft).toBeCloseTo(geom!.workspaceSidebarLeft, 0)
      // Sidebar border-r can inset chrome by 1px vs outer sidebar box.
      expect(Math.abs(geom!.chromeRight - geom!.workspaceSidebarRight)).toBeLessThanOrEqual(2)
      expect(geom!.spacerRight!).toBeLessThanOrEqual(geom!.chromeRight)
      expect(geom!.hasMenubar).toBe(false)
      expect(geom!.tauriChromeDeepDrag).toBe(true)
      expect(geom!.tauriSpacerDragRegion).toBe(true)
      expect(geom!.tauriTabBarDrag).toBe(true)
      expect(geom!.spacerHeight).toBeGreaterThanOrEqual(geom!.chromeHeight - 1)

      const tabFont = await page.evaluate(() => {
        const triggers = Array.from(
          document.querySelectorAll<HTMLElement>(
            '[data-jet-sidebar-view-tabs] [data-slot="tabs-trigger"]',
          ),
        )
        if (triggers.length < 2) return null
        const root = getComputedStyle(document.documentElement)
        const rootPx = parseFloat(root.fontSize)
        const threeXs = parseFloat(root.getPropertyValue("--jet-fs-3xs"))
        const expected = rootPx * threeXs
        const sizes = triggers.map(trigger => parseFloat(getComputedStyle(trigger).fontSize))
        const list = document.querySelector<HTMLElement>(
          '[data-jet-sidebar-view-tabs] [data-slot="tabs-list"]',
        )
        const listHeight = list ? parseFloat(getComputedStyle(list).height) : 0
        const expectedListHeight = rootPx * 1.5
        return {
          sizes,
          expected,
          listHeight,
          expectedListHeight,
          allSameSize: sizes.every(size => Math.abs(size - sizes[0]!) < 0.5),
        }
      })
      expect(tabFont, "sidebar view tabs must exist").not.toBeNull()
      expect(tabFont!.sizes).toHaveLength(2)
      expect(tabFont!.allSameSize).toBe(true)
      expect(tabFont!.sizes[0]).toBeCloseTo(tabFont!.expected, 0)
      expect(tabFont!.listHeight).toBeCloseTo(tabFont!.expectedListHeight, 0)
    } finally {
      await app.close()
    }
  })

  test("Tauri tab-bar drag region moves the native window", async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "tauri-e2e", "Tauri native window behavior")
    test.skip(
      testInfo.project.name === "tauri-e2e",
      "Embedded Tauri WebDriver does not expose OS-level window drag actions; region geometry is verified below",
    )

    const { app, page } = await launchJet()
    try {
      const drag = page.locator("[data-jet-tab-bar-drag]")
      await expectLocatorVisible(drag, { timeout: 10_000 })
      const box = await drag.boundingBox()
      expect(box).not.toBeNull()

      const getWindowPosition = () =>
        page.evaluate(async () => {
          const tauri = (
            window as Window & {
              __TAURI__?: {
                window?: {
                  getCurrentWindow?: () => {
                    outerPosition(): Promise<{ x: number; y: number }>
                  }
                }
              }
            }
          ).__TAURI__
          const currentWindow = tauri?.window?.getCurrentWindow?.()
          if (!currentWindow) throw new Error("Tauri global window API is unavailable")
          return currentWindow.outerPosition()
        })

      const before = await getWindowPosition()
      const x = box!.x + box!.width / 2
      const y = box!.y + box!.height / 2
      await page.mouse.move(x, y)
      await page.mouse.down()
      await page.mouse.move(x + 48, y + 32, { steps: 12 })
      await page.mouse.up()
      await page.waitForTimeout(150)
      const after = await getWindowPosition()

      expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y)).toBeGreaterThan(20)
    } finally {
      await app.close()
    }
  })

  test("Tauri tab bar exposes a native drag region", async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "tauri-e2e", "Tauri native window behavior")

    const { app, page } = await launchJet()
    try {
      const drag = page.locator("[data-jet-tab-bar-drag]")
      await expectLocatorVisible(drag, { timeout: 10_000 })
      await expectLocatorAttribute(drag, "data-tauri-drag-region", "true")
      const box = await drag.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.width).toBeGreaterThan(40)
      expect(box!.height).toBeGreaterThan(8)

      const spacer = page.locator("[data-jet-traffic-light-spacer]")
      await expectLocatorVisible(spacer, { timeout: 10_000 })
      await expectLocatorAttribute(spacer, "data-tauri-drag-region", "true")
      const spacerBox = await spacer.boundingBox()
      expect(spacerBox).not.toBeNull()
      expect(spacerBox!.width).toBeGreaterThan(40)
      expect(spacerBox!.height).toBeGreaterThan(8)

      const chrome = page.locator("[data-jet-sidebar-chrome]")
      await expectLocatorAttribute(chrome, "data-tauri-drag-region", "deep")
    } finally {
      await app.close()
    }
  })

  test("workspace roots use a prominent project icon", async () => {
    const { app, page } = await launchJet()
    try {
      await execCommand(page, "explorer.show")
      await expectListRows(page, {
        panel: "jet:explorer",
        minItems: 1,
        needle: "sample-workspace",
      })
      const projectIcon = page
        .locator('[data-jet-list-panel="jet:explorer"] [data-jet-project-icon]')
        .first()
      await expectLocatorVisible(projectIcon)
      const box = await projectIcon.boundingBox()
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(18)
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(18)
    } finally {
      await app.close()
    }
  })
})
