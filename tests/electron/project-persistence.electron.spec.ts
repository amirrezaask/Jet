import { expect, test } from "@playwright/test"
import {
  expectLocatorContainsText,
  expectLocatorCount,
  expectLocatorVisible,
  expectSelectorVisible,
} from "../shell/assert.js"

import { resolve } from "node:path"
import {
  launchJet,
  openNewAgentSession,
  ensureSidebarLayout,
  REPO_ROOT,
  execCommand,
} from "./_launch.js"

test.describe.skip("electron project persistence", () => {
  test("restores saved projects in mission sidebar after reload", async () => {
    const secondPath = resolve(REPO_ROOT, "fixtures/second-workspace")

    const { app, page } = await launchJet()
    try {
      await ensureSidebarLayout(page)
      await page.evaluate(path => window.__yaadeAgent!.addWorkspace(path), secondPath)
      await expect
        .poll(() => page.evaluate(() => window.__yaadeAgent!.listWorkspaces().length))
        .toBe(2)

      await expect
        .poll(async () => {
          const projects = await page.evaluate(async () => {
            const res = await fetch("/api/v1/projects")
            if (!res.ok) return [] as Array<{ rootPath: string }>
            return (await res.json()) as Array<{ rootPath: string }>
          })
          return projects.some(p => p.rootPath.includes("second-workspace"))
        })
        .toBe(true)

      // No client-side project catalog.
      await expect
        .poll(() =>
          page.evaluate(() => localStorage.getItem("jet-project-catalog-v1")),
        )
        .toBeNull()

      const secondChip = page
        .locator("[data-yaade-sidebar-project-filter-option]")
        .filter({ hasText: "second-workspace" })
      await expectLocatorVisible(secondChip)
      await openNewAgentSession(page)
      await expectSelectorVisible(page, "[data-yaade-terminal-modal]", {
        timeout: 20_000,
      })
      await execCommand(page, "yaade.goHome")
      await expectLocatorCount(page.locator("[data-yaade-terminal-modal]"), 0)

      await page.reload()
      await page.waitForFunction(() => window.__yaadeAgent != null, null, {
        timeout: 30_000,
      })
      await page.evaluate(() => window.__yaadeAgent!.waitForReady())
      await expect
        .poll(() => page.evaluate(() => window.__yaadeAgent!.listWorkspaces().length))
        .toBe(2)

      await ensureSidebarLayout(page)
      await expectSelectorVisible(page, "[data-yaade-mission-sidebar]")
      const filter = page.locator("[data-yaade-sidebar-project-filter]")
      await expectLocatorContainsText(filter, "sample-workspace")
      await expectLocatorContainsText(filter, "second-workspace")
      await expectLocatorCount(
        page.locator("[data-yaade-monaco-editor], .monaco-editor"),
        0,
      )
      await expectLocatorCount(page.locator("[data-yaade-workspace-sidebar]"), 0)
    } finally {
      await app.close()
    }
  })
})
