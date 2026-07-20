import { expect, test } from "@playwright/test"
import {
  expectLocatorAttribute,
  expectLocatorCount,
  expectLocatorVisible,
} from "../shell/assert.js"

import { expectListRows } from "../helpers/list.js"
import { execCommand, focusEditor, launchJet } from "./_launch.js"

test.describe("desktop shell", () => {
  test.skip(process.platform !== "darwin", "traffic lights are macOS-only")

  test("traffic lights live on the sidebar chrome surface", async () => {
    const { app, page } = await launchJet()
    try {
      await expectLocatorCount(page.locator("[data-gharargah-workspace-sidebar]"), 0)
      await execCommand(page, "explorer.show")
      const chrome = page.locator("[data-gharargah-sidebar-chrome]")
      await expectLocatorVisible(chrome, { timeout: 10_000 })

      const geom = await page.evaluate(() => {
        const root = document.documentElement
        const insetRaw = getComputedStyle(root).getPropertyValue("--gharargah-traffic-light-inset").trim()
        const probe = document.createElement("div")
        probe.style.width = insetRaw || "7.7rem"
        document.body.appendChild(probe)
        const zone = probe.getBoundingClientRect().width
        probe.remove()

        const sidebarChrome = document.querySelector<HTMLElement>("[data-gharargah-sidebar-chrome]")
        if (!sidebarChrome) return null
        const spacer = document.querySelector<HTMLElement>("[data-gharargah-traffic-light-spacer]")
        const workspaceSidebar = document.querySelector<HTMLElement>("[data-gharargah-workspace-sidebar]")
        const tabBarDrag = document.querySelector<HTMLElement>("[data-gharargah-tab-bar-drag]")
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
          hasMenubar: document.querySelector("[data-gharargah-sidebar-chrome] [role='menubar']") != null,
          hasTitlebar: document.querySelector("[data-gharargah-titlebar]") != null,
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
            '[data-gharargah-sidebar-view-tabs] [data-slot="tabs-trigger"]',
          ),
        )
        if (triggers.length < 2) return null
        const root = getComputedStyle(document.documentElement)
        const rootPx = parseFloat(root.fontSize)
        const xs = parseFloat(root.getPropertyValue("--gharargah-fs-xs"))
        const expected = rootPx * xs
        const sizes = triggers.map(trigger => parseFloat(getComputedStyle(trigger).fontSize))
        const list = document.querySelector<HTMLElement>(
          '[data-gharargah-sidebar-view-tabs] [data-slot="tabs-list"]',
        )
        const listHeight = list ? parseFloat(getComputedStyle(list).height) : 0
        const expectedListHeight = rootPx * 2
        return {
          sizes,
          expected,
          listHeight,
          expectedListHeight,
          labelsFit: triggers.every(trigger => trigger.scrollWidth <= trigger.clientWidth + 1),
          minTriggerWidth: Math.min(...triggers.map(trigger => trigger.getBoundingClientRect().width)),
          allSameSize: sizes.every(size => Math.abs(size - sizes[0]!) < 0.5),
        }
      })
      expect(tabFont, "sidebar view tabs must exist").not.toBeNull()
      expect(tabFont!.sizes).toHaveLength(2)
      expect(tabFont!.allSameSize).toBe(true)
      expect(tabFont!.labelsFit).toBe(true)
      expect(tabFont!.minTriggerWidth).toBeGreaterThanOrEqual(68)
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
      await execCommand(page, "explorer.show")
      const drag = page.locator("[data-gharargah-tab-bar-drag]")
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
      await execCommand(page, "explorer.show")
      const drag = page.locator("[data-gharargah-tab-bar-drag]")
      await expectLocatorVisible(drag, { timeout: 10_000 })
      await expectLocatorAttribute(drag, "data-tauri-drag-region", "true")
      const box = await drag.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.width).toBeGreaterThan(40)
      expect(box!.height).toBeGreaterThan(8)

      const spacer = page.locator("[data-gharargah-traffic-light-spacer]")
      await expectLocatorVisible(spacer, { timeout: 10_000 })
      await expectLocatorAttribute(spacer, "data-tauri-drag-region", "true")
      const spacerBox = await spacer.boundingBox()
      expect(spacerBox).not.toBeNull()
      expect(spacerBox!.width).toBeGreaterThan(40)
      expect(spacerBox!.height).toBeGreaterThan(8)

      const chrome = page.locator("[data-gharargah-sidebar-chrome]")
      await expectLocatorAttribute(chrome, "data-tauri-drag-region", "deep")
    } finally {
      await app.close()
    }
  })

  test("only panel bars on the window top edge are native drag regions", async () => {
    test.skip(process.platform !== "darwin", "native overlay chrome is macOS-only")
    const { app, page } = await launchJet()
    try {
      await page.evaluate(async () => {
        await window.__gharargahAgent!.openFile("src/index.ts")
        await window.__gharargahAgent!.waitForEditor()
      })
      await focusEditor(page)
      await page.keyboard.press("Meta+Shift+\\")
      await page.waitForFunction(
        () => document.querySelectorAll("[data-gharargah-tab-bar]").length === 2,
        null,
        { timeout: 10_000 },
      )

      const bars = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>("[data-gharargah-tab-bar]"))
          .map(bar => ({
            y: bar.getBoundingClientRect().y,
            height: bar.getBoundingClientRect().height,
            drag: bar.getAttribute("data-tauri-drag-region"),
          }))
          .sort((a, b) => a.y - b.y),
      )
      expect(bars).toHaveLength(2)
      expect(bars[0]!.drag).toBe("true")
      expect(bars[1]!.drag).toBeNull()
      expect(bars[1]!.y).toBeGreaterThan(bars[0]!.y + bars[0]!.height)
    } finally {
      await app.close()
    }
  })

  test("Files and Terminals explorers share row and project-icon geometry", async () => {
    const { app, page } = await launchJet()
    try {
      await execCommand(page, "explorer.show")
      await page.waitForSelector(
        '[data-gharargah-list-panel="gharargah:explorer"] [data-depth="1"]',
        { timeout: 10_000 },
      )
      const files = await page.evaluate(() => {
        const panel = document.querySelector('[data-gharargah-list-panel="gharargah:explorer"]')!
        const root = panel.querySelector<HTMLElement>('[data-depth="0"]')!
        const child = panel.querySelector<HTMLElement>('[data-depth="1"]')!
        const icon = root.querySelector<HTMLElement>("[data-gharargah-project-icon]")!
        return {
          rootHeight: root.getBoundingClientRect().height,
          childHeight: child.getBoundingClientRect().height,
          rootFont: parseFloat(getComputedStyle(root).fontSize),
          childFont: parseFloat(getComputedStyle(child).fontSize),
          iconSize: icon.getBoundingClientRect().width,
        }
      })

      await execCommand(page, "terminal.new")
      await execCommand(page, "terminal.explorer.show")
      await page.waitForSelector(
        '[data-gharargah-list-panel="gharargah:terminal-explorer"] [data-depth="1"]',
        { timeout: 30_000 },
      )
      const terminals = await page.evaluate(() => {
        const panel = document.querySelector('[data-gharargah-list-panel="gharargah:terminal-explorer"]')!
        const root = panel.querySelector<HTMLElement>('[data-depth="0"]')!
        const child = panel.querySelector<HTMLElement>('[data-depth="1"]')!
        const icon = root.querySelector<HTMLElement>("[data-gharargah-project-icon]")!
        return {
          rootHeight: root.getBoundingClientRect().height,
          childHeight: child.getBoundingClientRect().height,
          rootFont: parseFloat(getComputedStyle(root).fontSize),
          childFont: parseFloat(getComputedStyle(child).fontSize),
          iconSize: icon.getBoundingClientRect().width,
        }
      })

      expect(terminals.rootHeight).toBeCloseTo(files.rootHeight, 1)
      expect(terminals.childHeight).toBeCloseTo(files.childHeight, 1)
      expect(terminals.rootFont).toBeCloseTo(files.rootFont, 1)
      expect(terminals.childFont).toBeCloseTo(files.childFont, 1)
      expect(terminals.iconSize).toBeCloseTo(files.iconSize, 1)
    } finally {
      await app.close()
    }
  })

  test("workspace roots use a prominent project icon", async () => {
    const { app, page } = await launchJet()
    try {
      await execCommand(page, "explorer.show")
      await expectListRows(page, {
        panel: "gharargah:explorer",
        minItems: 1,
        needle: "sample-workspace",
      })
      const projectIcon = page
        .locator('[data-gharargah-list-panel="gharargah:explorer"] [data-gharargah-project-icon]')
        .first()
      await expectLocatorVisible(projectIcon)
      const box = await projectIcon.boundingBox()
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(15)
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(15)
    } finally {
      await app.close()
    }
  })
})
