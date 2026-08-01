import { expect, test } from "@playwright/test"
import fs from "node:fs"
import os from "node:os"
import path, { resolve } from "node:path"
import {
  expectLocatorCount,
  expectLocatorVisible,
  expectSelectorVisible,
} from "../shell/assert.js"
import { execCommand, hasPtySpawn, launchJet, REPO_ROOT } from "./_launch.js"

const ptyAvailable = hasPtySpawn()

test.describe("sidebar view", () => {
  test.skip(!ptyAvailable, "PTY sessions are unavailable on this machine")

  test("project filter chips, selection, unread sticky, preference persistence", async () => {
    const temporaryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "gharargah-sidebar-session-e2e-"),
    )
    const binDir = path.join(temporaryRoot, "bin")
    fs.mkdirSync(binDir)
    fs.writeFileSync(
      path.join(binDir, "codex"),
      [
        "#!/bin/sh",
        "printf 'GHARARGAH_SIDEBAR_AGENT_READY\\r\\n'",
        "trap 'exit 0' TERM INT",
        "while :; do sleep 1; done",
      ].join("\n"),
      { mode: 0o755 },
    )
    const { app, page } = await launchJet({
      userDataDir: path.join(temporaryRoot, "user-data"),
      env: { PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}` },
    })
    try {
      await execCommand(page, "ui.setSessionLayout.sidebar")
      await expect
        .poll(() =>
          page.evaluate(
            () => window.__gharargahAgent!.getState().sessionLayout,
          ),
        )
        .toBe("sidebar")
      await expectSelectorVisible(
        page,
        '[data-gharargah-session-layout="sidebar"]',
      )
      await expectSelectorVisible(page, "[data-gharargah-mission-sidebar]")
      await expectSelectorVisible(page, "[data-gharargah-sidebar-project-filter]")
      await expectLocatorCount(
        page.locator("[data-gharargah-sidebar-grouping]"),
        0,
      )
      await expectLocatorCount(
        page.locator("[data-gharargah-sidebar-project-list]"),
        0,
      )

      const allChip = page.locator(
        '[data-gharargah-sidebar-project-filter-option="all"]',
      )
      await expect
        .poll(() => allChip.getAttribute("data-state"))
        .toBe("on")

      await page.locator("[data-gharargah-sidebar-new-session]").click()
      await page.locator('[data-gharargah-agent-cli-option="codex"]').click()
      await expectSelectorVisible(
        page,
        '[data-gharargah-terminal-modal][data-gharargah-session-presentation="inline"]',
        { timeout: 20_000 },
      )
      await expect
        .poll(() =>
          page.evaluate(() => {
            const sidebar = document.querySelector(
              "[data-gharargah-mission-sidebar]",
            )
            const bell = sidebar?.querySelector(
              "[data-gharargah-notification-bell]",
            )
            const body = document.querySelector(
              "[data-gharargah-terminal-modal-body]",
            )
            if (!sidebar || !bell || !body) return false
            return (
              (sidebar.compareDocumentPosition(body) &
                Node.DOCUMENT_POSITION_FOLLOWING) !==
              0
            )
          }),
        )
        .toBe(true)
      const sessionRow = page.locator("[data-gharargah-sidebar-session]").first()
      await expectLocatorVisible(sessionRow, { timeout: 20_000 })
      const activeSectionLabel = page.locator(
        '[data-gharargah-sidebar-section-label="active"]',
      )
      await expect
        .poll(() => activeSectionLabel.evaluate(element => element.textContent?.trim()))
        .toBe("Active")
      const sessionId = await sessionRow.getAttribute(
        "data-gharargah-sidebar-session",
      )
      expect(sessionId).toBeTruthy()

      await sessionRow.click()
      await expect
        .poll(() =>
          sessionRow.getAttribute("data-gharargah-sidebar-session-selected"),
        )
        .toBe("")

      const state = await page.evaluate(() => window.__gharargahAgent!.getState())
      const projectName = state.workspaces[0]?.name ?? "sample-workspace"
      const projectId =
        state.workspaces[0]?.id ?? state.workspaces[0]?.path ?? null

      const projectChip = page
        .locator("[data-gharargah-sidebar-project-filter-option]")
        .filter({ hasText: projectName })
        .first()
      await expectLocatorVisible(projectChip)
      await projectChip.click()
      await expect
        .poll(() => projectChip.getAttribute("data-state"))
        .toBe("on")
      await expect
        .poll(() => activeSectionLabel.evaluate(element => element.textContent?.trim()))
        .toBe("Active")
      await expect
        .poll(() => allChip.getAttribute("data-state"))
        .toBe("off")

      await expectSelectorVisible(page, "[data-gharargah-sidebar-unread-list]")
      await expectLocatorVisible(
        page.locator("[data-gharargah-sidebar-session]").first(),
      )

      await allChip.click()
      await expect
        .poll(() => allChip.getAttribute("data-state"))
        .toBe("on")

      await page.evaluate(
        async ({ sessionId: sid, projectId: pid, projectName: pname }) => {
          await window.__gharargahAgent!.ingestNotification!({
            source: "provider-hook",
            type: "turn-completed",
            title: "Sidebar unread seed",
            message: "Unread for sidebar",
            sessionId: sid!,
            projectId: pid,
            projectName: pname,
            sessionTitle: "Sidebar session",
            provider: "codex",
            eventId: `e2e-sidebar-${Date.now()}`,
          })
        },
        { sessionId, projectId, projectName },
      )

      await expect
        .poll(async () => {
          const counts = await page.evaluate(() =>
            window.__gharargahAgent!.getNotificationCounts!(),
          )
          return counts.totalUnread
        }, { timeout: 15_000 })
        .toBeGreaterThan(0)

      await expectLocatorVisible(
        page.locator("[data-gharargah-sidebar-unread-badge]").first(),
      )

      const unreadRow = page
        .locator("[data-gharargah-sidebar-session]")
        .filter({ has: page.locator("[data-gharargah-sidebar-unread-badge]") })
        .first()
      const selectedId = await unreadRow.getAttribute(
        "data-gharargah-sidebar-session",
      )
      expect(selectedId).toBeTruthy()
      await unreadRow.click()
      await expect
        .poll(async () => {
          const counts = await page.evaluate(() =>
            window.__gharargahAgent!.getNotificationCounts!(),
          )
          return counts.totalUnread
        }, { timeout: 15_000 })
        .toBe(0)
      await expectLocatorVisible(
        page.locator(
          `[data-gharargah-sidebar-session="${selectedId}"][data-gharargah-sidebar-session-selected]`,
        ),
      )

      // Toggle lives left of search in the expanded header.
      await expect
        .poll(() =>
          page.evaluate(() => {
            const trigger = document.querySelector(
              '[data-gharargah-mission-sidebar] [data-slot="sidebar-trigger"]',
            )
            const search = document.querySelector(
              "[data-gharargah-sidebar-search]",
            )
            if (!trigger || !search) return false
            return (
              (trigger.compareDocumentPosition(search) &
                Node.DOCUMENT_POSITION_FOLLOWING) !==
              0
            )
          }),
        )
        .toBe(true)

      // Drag rail to widen; width persists in appearance settings.
      const beforeWidth = await page.evaluate(() => {
        const raw = localStorage.getItem("jet-appearance-settings")
        if (!raw) return 300
        return (
          (JSON.parse(raw) as { sidebarWidth?: number }).sidebarWidth ?? 300
        )
      })
      const rail = page.locator('[data-slot="sidebar-rail"]')
      await expectLocatorVisible(rail)
      const box = await rail.boundingBox()
      expect(box).toBeTruthy()
      const cx = box!.x + box!.width / 2
      const cy = box!.y + box!.height / 2
      await page.mouse.move(cx, cy)
      await page.mouse.down()
      await page.mouse.move(cx + 72, cy, { steps: 8 })
      await page.mouse.up()
      await expect
        .poll(() =>
          page.evaluate(() => {
            const raw = localStorage.getItem("jet-appearance-settings")
            if (!raw) return null
            return (JSON.parse(raw) as { sidebarWidth?: number }).sidebarWidth ?? null
          }),
        )
        .toBeGreaterThan(beforeWidth)

      await page.getByRole("button", { name: "Toggle sidebar" }).first().click()
      await expect
        .poll(() =>
          page
            .locator("[data-gharargah-mission-sidebar]")
            .getAttribute("data-gharargah-sidebar-state"),
        )
        .toBe("collapsed")

      const selectedCompactRow = page.locator(
        "[data-gharargah-sidebar-session-selected]",
      )
      const projectMonogram = selectedCompactRow.locator(
        "[data-gharargah-sidebar-project-monogram]",
      )
      await expectLocatorVisible(projectMonogram)
      await expect
        .poll(() =>
          projectMonogram.getAttribute(
            "data-gharargah-sidebar-project-name",
          ),
        )
        .toBe(projectName)
      await expect
        .poll(() => projectMonogram.textContent())
        .toBe("SW")
      await expect
        .poll(() => selectedCompactRow.getAttribute("aria-label"))
        .toMatch(new RegExp(`project ${projectName}`, "i"))
      await expect
        .poll(async () => {
          const label = await selectedCompactRow.getAttribute("aria-label")
          return label != null && !/codex/i.test(label)
        })
        .toBe(true)
      await expect
        .poll(async () => {
          const [sidebarBox, rowBox, monogramBox] = await Promise.all([
            page
              .locator("[data-gharargah-mission-sidebar]")
              .boundingBox(),
            selectedCompactRow.boundingBox(),
            projectMonogram.boundingBox(),
          ])
          if (!sidebarBox || !rowBox || !monogramBox) return null
          const center = (box: { x: number; width: number }) =>
            box.x + box.width / 2
          return {
            rowCentered:
              Math.abs(center(rowBox) - center(sidebarBox)) <= 1,
            monogramCentered:
              Math.abs(center(monogramBox) - center(sidebarBox)) <= 1,
            // 1.125rem monogram — allow rem/subpixel variance across zoom.
            monogramSized:
              monogramBox.width >= 14 &&
              monogramBox.width <= 20 &&
              monogramBox.height >= 14 &&
              monogramBox.height <= 20,
          }
        })
        .toEqual({
          rowCentered: true,
          monogramCentered: true,
          monogramSized: true,
        })
      await projectMonogram.hover()
      await expect
        .poll(() =>
          page
            .getByRole("tooltip")
            .filter({ hasText: projectName })
            .isVisible(),
        )
        .toBe(true)

      await page.getByRole("button", { name: "Toggle sidebar" }).first().click()
      await expect
        .poll(() =>
          page
            .locator("[data-gharargah-mission-sidebar]")
            .getAttribute("data-gharargah-sidebar-state"),
        )
        .toBe("expanded")

      // Re-select project filter and persist (absolute path)
      await projectChip.click()
      const filterPath = await projectChip.getAttribute(
        "data-gharargah-sidebar-project-filter-option",
      )
      expect(filterPath).toBeTruthy()
      expect(filterPath).not.toBe("all")

      await expect
        .poll(() =>
          page.evaluate(() => {
            const raw = localStorage.getItem("jet-appearance-settings")
            if (!raw) return null
            return JSON.parse(raw) as {
              sessionLayout?: string
              sidebarProjectFilterPath?: string | null
            }
          }),
        )
        .toEqual(
          expect.objectContaining({
            sessionLayout: "sidebar",
            sidebarProjectFilterPath: filterPath,
          }),
        )

      await page.reload({ waitUntil: "domcontentloaded" })
      await page.waitForFunction(() => window.__gharargahAgent != null, null, {
        timeout: 30_000,
      })
      await page.evaluate(() => window.__gharargahAgent!.waitForReady())
      await expect
        .poll(() =>
          page.evaluate(
            () => window.__gharargahAgent!.getState().sessionLayout,
          ),
        )
        .toBe("sidebar")
      await expectSelectorVisible(page, "[data-gharargah-mission-sidebar]", {
        timeout: 30_000,
      })
      // Catalog restore is async — wait for projects before asserting list.
      await expect
        .poll(
          () =>
            page.evaluate(
              () => window.__gharargahAgent!.listWorkspaces().length,
            ),
          { timeout: 30_000 },
        )
        .toBeGreaterThan(0)
      await expectSelectorVisible(
        page,
        "[data-gharargah-sidebar-project-filter]",
        { timeout: 30_000 },
      )
      await expectSelectorVisible(page, "[data-gharargah-sidebar-unread-list]", {
        timeout: 30_000,
      })
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const raw = localStorage.getItem("jet-appearance-settings")
              if (!raw) return null
              return (
                JSON.parse(raw) as { sidebarProjectFilterPath?: string | null }
              ).sidebarProjectFilterPath
            }),
          { timeout: 15_000 },
        )
        .toBe(filterPath)
      await expect
        .poll(
          () =>
            page
              .locator("[data-gharargah-mission-sidebar]")
              .getAttribute("data-gharargah-sidebar-project-filter-active"),
          { timeout: 15_000 },
        )
        .toBe(filterPath)
      await expect
        .poll(() =>
          page
            .locator('[data-gharargah-sidebar-project-filter-option="all"]')
            .getAttribute("data-state"),
        )
        .toBe("off")
    } finally {
      await app.close()
    }
  })

  test("added projects persist in host SQLite across reload", async () => {
    const secondPath = resolve(REPO_ROOT, "fixtures/second-workspace")

    const { app, page } = await launchJet()
    try {
      await execCommand(page, "ui.setSessionLayout.sidebar")
      await expect
        .poll(() =>
          page.evaluate(
            () => window.__gharargahAgent!.getState().sessionLayout,
          ),
        )
        .toBe("sidebar")
      await page.evaluate(
        path => window.__gharargahAgent!.addWorkspace(path),
        secondPath,
      )
      await expect
        .poll(() =>
          page.evaluate(() => window.__gharargahAgent!.listWorkspaces().length),
        )
        .toBe(2)
      await expect
        .poll(async () => {
          const projects = await page.evaluate(async () => {
            const res = await fetch("/api/v1/projects")
            if (!res.ok) return [] as Array<{ rootPath: string }>
            return (await res.json()) as Array<{ rootPath: string }>
          })
          return projects.filter(p =>
            /sample-workspace|second-workspace/.test(p.rootPath),
          ).length
        })
        .toBeGreaterThanOrEqual(2)
      await expect
        .poll(() =>
          page.evaluate(() => localStorage.getItem("jet-project-catalog-v1")),
        )
        .toBeNull()

      await page.reload({ waitUntil: "domcontentloaded" })
      await page.waitForFunction(() => window.__gharargahAgent != null, null, {
        timeout: 30_000,
      })
      await page.evaluate(() => window.__gharargahAgent!.waitForReady())
      await expect
        .poll(() =>
          page.evaluate(() => window.__gharargahAgent!.listWorkspaces().length),
        )
        .toBe(2)
      await expectSelectorVisible(
        page,
        '[data-gharargah-sidebar-project-filter-option]:not([data-gharargah-sidebar-project-filter-option="all"])',
        { timeout: 30_000 },
      )
      const chipCount = await page
        .locator(
          '[data-gharargah-sidebar-project-filter-option]:not([data-gharargah-sidebar-project-filter-option="all"])',
        )
        .count()
      expect(chipCount).toBeGreaterThanOrEqual(2)
    } finally {
      await app.close()
    }
  })

  test("removes a project from sidebar filter chip context menu", async () => {
    const secondPath = resolve(REPO_ROOT, "fixtures/second-workspace")
    const { app, page } = await launchJet()
    try {
      await execCommand(page, "ui.setSessionLayout.sidebar")
      await expect
        .poll(() =>
          page.evaluate(
            () => window.__gharargahAgent!.getState().sessionLayout,
          ),
        )
        .toBe("sidebar")

      await page.evaluate(
        path => window.__gharargahAgent!.addWorkspace(path),
        secondPath,
      )
      await expect
        .poll(() =>
          page.evaluate(() => window.__gharargahAgent!.listWorkspaces().length),
        )
        .toBe(2)

      await expectSelectorVisible(page, "[data-gharargah-sidebar-project-filter]")
      const chip = page.locator(
        '[data-gharargah-sidebar-project-filter-option]:not([data-gharargah-sidebar-project-filter-option="all"])',
      ).filter({ hasText: "second-workspace" })
      await expectLocatorVisible(chip)
      await chip.click()
      await expect
        .poll(() => chip.getAttribute("data-state"))
        .toBe("on")
      await expect
        .poll(() =>
          page
            .locator("[data-gharargah-mission-sidebar]")
            .getAttribute("data-gharargah-sidebar-project-filter-active"),
        )
        .toMatch(/second-workspace/)

      await chip.click({ button: "right" })
      const menu = page.locator(
        "[data-gharargah-sidebar-project-filter-menu]",
      )
      await expectLocatorVisible(menu)
      await menu.getByRole("menuitem", { name: "Remove project" }).click()

      await expect
        .poll(() =>
          page.evaluate(() =>
            window.__gharargahAgent!.listWorkspaces().map(p => p.name),
          ),
        )
        .not.toContain("second-workspace")
      await expectLocatorCount(chip, 0)
      await expect
        .poll(() =>
          page
            .locator('[data-gharargah-sidebar-project-filter-option="all"]')
            .getAttribute("data-state"),
        )
        .toBe("on")
      await expect
        .poll(() =>
          page
            .locator("[data-gharargah-mission-sidebar]")
            .getAttribute("data-gharargah-sidebar-project-filter-active"),
        )
        .toBe("all")
    } finally {
      await app.close()
    }
  })
})
