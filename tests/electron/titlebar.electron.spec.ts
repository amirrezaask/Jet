import { expect, test } from "@playwright/test"
import { expectListRows } from "../helpers/list.js"
import { execCommand, launchJet } from "./_launch.js"

test.describe("desktop shell", () => {
  test.skip(process.platform !== "darwin", "traffic lights are macOS-only")

  test("traffic lights live on the sidebar titlebar surface", async () => {
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
          zone,
        }
      })

      expect(geom, "titlebar element must exist in Electron shell").not.toBeNull()
      expect(geom!.spacerRight, "traffic-light spacer must render").not.toBeNull()
      expect(geom!.spacerRight!).toBeGreaterThanOrEqual(geom!.zone)
      expect(geom!.titlebarSidebarLeft).toBeCloseTo(geom!.workspaceSidebarLeft, 0)
      expect(geom!.titlebarSidebarRight).toBeCloseTo(geom!.workspaceSidebarRight, 0)
      expect(geom!.titlebarMainLeft).toBeCloseTo(geom!.workspaceSidebarRight, 0)
      expect(geom!.spacerRight!).toBeLessThanOrEqual(geom!.titlebarSidebarRight)
      expect(geom!.titlebarSidebarColor).toBe(geom!.workspaceSidebarColor)
      expect(geom!.hasMenubar).toBe(false)
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
      await expect(projectIcon).toBeVisible()
      const box = await projectIcon.boundingBox()
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(18)
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(18)
    } finally {
      await app.close()
    }
  })
})
