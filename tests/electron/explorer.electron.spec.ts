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

import { execCommand, launchJet } from "./_launch.js"
import { expectListRows } from "../helpers/list.js"
import { EXPLORER_PANEL } from "../helpers/shell.js"

const EXPLORER_ITEMS = `${EXPLORER_PANEL} [data-jet-list-item]`

test.describe("electron explorer", () => {
  test("shows file tree and opens file from explorer", async () => {
    const { app, page } = await launchJet()
    try {
      await execCommand(page, "explorer.show")
      await expectSelectorVisible(page, EXPLORER_PANEL)
      await expectListRows(page, { panel: "jet:explorer", minItems: 1, needle: "sample-workspace" })

      await page.locator(EXPLORER_ITEMS).filter({ hasText: /^src$/i }).first().click()
      await page.waitForTimeout(400)
      await page.locator(EXPLORER_ITEMS).filter({ hasText: /utils\.ts/i }).first().click()
      await page.evaluate(() => window.__jetAgent!.waitForEditor())
      await expectContainsText(page, ".cm-editor", "export function greet")
    } finally {
      await app.close()
    }
  })

  test("Cmd-b and sidebar toggle button hide and show the sidebar", async () => {
    const { app, page } = await launchJet()
    try {
      await execCommand(page, "explorer.show")
      await expectSelectorVisible(page, "[data-jet-workspace-sidebar]")
      await expectLocatorCount(page.locator("[data-jet-sidebar-chrome] [data-jet-sidebar-toggle]"), 1)

      await page.locator("[data-jet-sidebar-chrome] [data-jet-sidebar-toggle]").click()
      await expectSelectorHidden(page, "[data-jet-workspace-sidebar]")
      // Closed: reopen control lives on the tab bar — no sidebar-width gap reserved.
      await expectLocatorCount(page.locator("[data-jet-tab-bar] [data-jet-sidebar-toggle]"), 1)

      const geom = await page.evaluate(() => {
        const tabBar = document.querySelector<HTMLElement>("[data-jet-tab-bar]")
        const tabsList = document.querySelector<HTMLElement>(
          "[data-jet-tab-bar] [data-slot='tabs-list']",
        )
        const inset = document.querySelector<HTMLElement>("[data-slot='sidebar-inset']")
        if (!tabBar || !inset) return null
        const barRect = tabBar.getBoundingClientRect()
        const insetRect = inset.getBoundingClientRect()
        const tabsLeft = tabsList?.getBoundingClientRect().left ?? null
        const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize)
        const trafficInset =
          parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue("--jet-traffic-light-inset"),
          ) * rootPx
        return {
          tabBarLeft: barRect.left,
          insetLeft: insetRect.left,
          tabsLeft,
          trafficInset,
          sidebarWidthRem: 20 * rootPx,
        }
      })
      expect(geom).not.toBeNull()
      // Panel leaf border can inset the tab bar 1px vs SidebarInset.
      expect(Math.abs(geom!.tabBarLeft - geom!.insetLeft)).toBeLessThanOrEqual(2)
      // Tabs (or toggle) must start near the inset edge — not after a closed-sidebar reserve.
      const contentLeft = geom!.tabsLeft ?? geom!.tabBarLeft
      expect(contentLeft - geom!.insetLeft).toBeLessThan(geom!.sidebarWidthRem * 0.5)
      expect(contentLeft - geom!.insetLeft).toBeLessThan(geom!.trafficInset + 48)

      await execCommand(page, "workbench.action.toggleSidebarVisibility")
      await expectSelectorVisible(page, "[data-jet-workspace-sidebar]")
      await expectLocatorVisible(page.locator("[data-jet-sidebar-view-tabs]"))
      await expectLocatorCount(page.locator("[data-jet-sidebar-chrome] [data-jet-sidebar-toggle]"), 1)
    } finally {
      await app.close()
    }
  })
})
