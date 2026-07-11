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

import { expectListRows } from "../helpers/list.js"
import { execCommand, launchJet } from "./_launch.js"

test.describe("desktop shell", () => {
  test.skip(process.platform !== "darwin", "traffic lights are macOS-only")

  test("traffic lights live on the sidebar titlebar surface", async () => {
    const { app, page } = await launchJet()
    try {
      const bar = page.locator("[data-jet-titlebar]")
      await expectLocatorVisible(bar, { timeout: 10_000 })

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
        const titlebarSidebar = document.querySelector<HTMLElement>("[data-jet-titlebar-sidebar]")
        const titlebarMain = document.querySelector<HTMLElement>("[data-jet-titlebar-main]")
        const workspaceSidebar = document.querySelector<HTMLElement>("[data-jet-workspace-sidebar]")
        if (!titlebarSidebar || !titlebarMain || !workspaceSidebar) return null
        const titlebarSidebarRect = titlebarSidebar.getBoundingClientRect()
        const titlebarMainRect = titlebarMain.getBoundingClientRect()
        const workspaceSidebarRect = workspaceSidebar.getBoundingClientRect()
        return {
          barLeft: bar.getBoundingClientRect().left,
          spacerRight: spacer?.getBoundingClientRect().right ?? null,
          titlebarSidebarLeft: titlebarSidebarRect.left,
          titlebarSidebarRight: titlebarSidebarRect.right,
          titlebarMainLeft: titlebarMainRect.left,
          workspaceSidebarLeft: workspaceSidebarRect.left,
          workspaceSidebarRight: workspaceSidebarRect.right,
          titlebarSidebarColor: getComputedStyle(titlebarSidebar).backgroundColor,
          workspaceSidebarColor: getComputedStyle(workspaceSidebar).backgroundColor,
          hasMenubar: document.querySelector("[data-jet-titlebar] [role='menubar']") != null,
          tauriDragRegion: bar.hasAttribute("data-tauri-drag-region"),
          tauriCenterDragRegion:
            document.querySelector("[data-jet-titlebar-main] [data-tauri-drag-region]") != null,
          tauriSpacerDragRegion:
            spacer?.hasAttribute("data-tauri-drag-region") === true,
          tauriSidebarDeepDrag:
            titlebarSidebar.getAttribute("data-tauri-drag-region") === "deep",
          spacerHeight: spacer?.getBoundingClientRect().height ?? 0,
          titlebarHeight: bar.getBoundingClientRect().height,
          zone,
        }
      })

      expect(geom, "titlebar element must exist in desktop shell").not.toBeNull()
      expect(geom!.spacerRight, "traffic-light spacer must render").not.toBeNull()
      expect(geom!.spacerRight!).toBeGreaterThanOrEqual(geom!.zone)
      expect(geom!.titlebarSidebarLeft).toBeCloseTo(geom!.workspaceSidebarLeft, 0)
      expect(geom!.titlebarSidebarRight).toBeCloseTo(geom!.workspaceSidebarRight, 0)
      expect(geom!.titlebarMainLeft).toBeCloseTo(geom!.workspaceSidebarRight, 0)
      expect(geom!.spacerRight!).toBeLessThanOrEqual(geom!.titlebarSidebarRight)
      expect(geom!.titlebarSidebarColor).toBe(geom!.workspaceSidebarColor)
      expect(geom!.hasMenubar).toBe(false)
      expect(geom!.tauriDragRegion).toBe(true)
      expect(geom!.tauriCenterDragRegion).toBe(true)
      expect(geom!.tauriSpacerDragRegion).toBe(true)
      expect(geom!.tauriSidebarDeepDrag).toBe(true)
      expect(geom!.spacerHeight).toBeGreaterThanOrEqual(geom!.titlebarHeight - 1)

      const tabFont = await page.evaluate(() => {
        const triggers = Array.from(
          document.querySelectorAll<HTMLElement>(
            '[data-jet-titlebar-tabs] [data-slot="tabs-trigger"]',
          ),
        )
        if (triggers.length < 2) return null
        const root = getComputedStyle(document.documentElement)
        const rootPx = parseFloat(root.fontSize)
        const threeXs = parseFloat(root.getPropertyValue("--jet-fs-3xs"))
        const expected = rootPx * threeXs
        const sizes = triggers.map(trigger => parseFloat(getComputedStyle(trigger).fontSize))
        const list = document.querySelector<HTMLElement>('[data-jet-titlebar-tabs] [data-slot="tabs-list"]')
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
      expect(tabFont, "titlebar sidebar tabs must exist").not.toBeNull()
      expect(tabFont!.sizes).toHaveLength(2)
      expect(tabFont!.allSameSize).toBe(true)
      expect(tabFont!.sizes[0]).toBeCloseTo(tabFont!.expected, 0)
      expect(tabFont!.listHeight).toBeCloseTo(tabFont!.expectedListHeight, 0)
    } finally {
      await app.close()
    }
  })

  test("Tauri titlebar drag region moves the native window", async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "tauri-e2e", "Tauri native window behavior")
    test.skip(
      testInfo.project.name === "tauri-e2e",
      "Embedded Tauri WebDriver does not expose OS-level window drag actions; region geometry is verified below",
    )

    const { app, page } = await launchJet()
    try {
      const titlebar = page.locator("[data-jet-titlebar-main] [data-tauri-drag-region]")
      await expectLocatorVisible(titlebar, { timeout: 10_000 })
      const box = await titlebar.boundingBox()
      expect(box).not.toBeNull()

      const getWindowPosition = () => page.evaluate(async () => {
        const tauri = (window as Window & {
          __TAURI__?: { window?: { getCurrentWindow?: () => { outerPosition(): Promise<{ x: number; y: number }> } } }
        }).__TAURI__
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

  test("Tauri titlebar exposes a native drag region", async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "tauri-e2e", "Tauri native window behavior")

    const { app, page } = await launchJet()
    try {
      const titlebar = page.locator("[data-jet-titlebar-main] [data-tauri-drag-region]")
      await expectLocatorVisible(titlebar, { timeout: 10_000 })
      await expectLocatorAttribute(titlebar, "data-tauri-drag-region", "true")
      const box = await titlebar.boundingBox()
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

      const sidebar = page.locator("[data-jet-titlebar-sidebar]")
      await expectLocatorAttribute(sidebar, "data-tauri-drag-region", "deep")
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
      const projectIcon = page.locator(
        '[data-jet-list-panel="jet:explorer"] [data-jet-project-icon]',
      ).first()
      await expectLocatorVisible(projectIcon)
      const box = await projectIcon.boundingBox()
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(18)
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(18)
    } finally {
      await app.close()
    }
  })
})
