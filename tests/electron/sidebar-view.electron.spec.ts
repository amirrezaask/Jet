import { expect, test } from "@playwright/test"
import fs from "node:fs"
import os from "node:os"
import path, { resolve } from "node:path"
import {
  expectLocatorCount,
  expectLocatorVisible,
  expectSelectorVisible,
} from "../shell/assert.js"
import { hasPtySpawn, launchJet, REPO_ROOT } from "./_launch.js"

const ptyAvailable = hasPtySpawn()

test.describe.skip("sidebar view", () => {
  test.skip(!ptyAvailable, "PTY sessions are unavailable on this machine")

  test("project filter chips, selection, unread sticky, preference persistence", async () => {
    const temporaryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "yaade-sidebar-session-e2e-"),
    )
    const binDir = path.join(temporaryRoot, "bin")
    fs.mkdirSync(binDir)
    fs.writeFileSync(
      path.join(binDir, "codex"),
      [
        "#!/bin/sh",
        "printf 'YAADE_SIDEBAR_AGENT_READY\\r\\n'",
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
      await expect
        .poll(() =>
          page.evaluate(
            () => window.__yaadeAgent!.getState().sessionLayout,
          ),
        )
        .toBe("sidebar")
      await expectSelectorVisible(
        page,
        '[data-yaade-session-layout="sidebar"]',
      )
      await expectSelectorVisible(page, "[data-yaade-mission-sidebar]")
      await expectSelectorVisible(page, "[data-yaade-sidebar-project-filter]")
      await expectLocatorCount(
        page.locator("[data-yaade-sidebar-grouping]"),
        0,
      )
      await expectLocatorCount(
        page.locator("[data-yaade-sidebar-project-list]"),
        0,
      )

      const allChip = page.locator(
        '[data-yaade-sidebar-project-filter-option="all"]',
      )
      await expect
        .poll(() => allChip.getAttribute("data-state"))
        .toBe("on")

      await page.locator("[data-yaade-sidebar-new-session]").click()
      await page.locator('[data-yaade-agent-cli-option="codex"]').click()
      await expectSelectorVisible(
        page,
        '[data-yaade-terminal-modal][data-yaade-session-presentation="inline"]',
        { timeout: 20_000 },
      )
      await expect
        .poll(() =>
          page.evaluate(() => {
            const sidebar = document.querySelector(
              "[data-yaade-mission-sidebar]",
            )
            const bell = sidebar?.querySelector(
              "[data-yaade-notification-bell]",
            )
            const body = document.querySelector(
              "[data-yaade-terminal-modal-body]",
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
      const sessionRow = page.locator("[data-yaade-sidebar-session]").first()
      await expectLocatorVisible(sessionRow, { timeout: 20_000 })
      const activeSectionLabel = page.locator(
        '[data-yaade-sidebar-section-label="active"]',
      )
      await expect
        .poll(() => activeSectionLabel.evaluate(element => element.textContent?.trim()))
        .toBe("Active")
      const sessionId = await sessionRow.getAttribute(
        "data-yaade-sidebar-session",
      )
      expect(sessionId).toBeTruthy()

      await sessionRow.click()
      await expect
        .poll(() =>
          sessionRow.getAttribute("data-yaade-sidebar-session-selected"),
        )
        .toBe("")

      const state = await page.evaluate(() => window.__yaadeAgent!.getState())
      const projectName = state.workspaces[0]?.name ?? "sample-workspace"
      const projectId =
        state.workspaces[0]?.id ?? state.workspaces[0]?.path ?? null

      const projectChip = page
        .locator("[data-yaade-sidebar-project-filter-option]")
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

      await expectSelectorVisible(page, "[data-yaade-sidebar-unread-list]")
      await expectLocatorVisible(
        page.locator("[data-yaade-sidebar-session]").first(),
      )

      await allChip.click()
      await expect
        .poll(() => allChip.getAttribute("data-state"))
        .toBe("on")

      await page.evaluate(
        async ({ sessionId: sid, projectId: pid, projectName: pname }) => {
          await window.__yaadeAgent!.ingestNotification!({
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
            window.__yaadeAgent!.getNotificationCounts!(),
          )
          return counts.totalUnread
        }, { timeout: 15_000 })
        .toBeGreaterThan(0)

      await expect
        .poll(() => sessionRow.textContent(), { timeout: 15_000 })
        .toContain("Sidebar session")

      await expectLocatorVisible(
        page.locator("[data-yaade-sidebar-unread-badge]").first(),
      )

      const unreadRow = page
        .locator("[data-yaade-sidebar-session]")
        .filter({ has: page.locator("[data-yaade-sidebar-unread-badge]") })
        .first()
      const selectedId = await unreadRow.getAttribute(
        "data-yaade-sidebar-session",
      )
      expect(selectedId).toBeTruthy()
      await unreadRow.click()
      await expect
        .poll(async () => {
          const counts = await page.evaluate(() =>
            window.__yaadeAgent!.getNotificationCounts!(),
          )
          return counts.totalUnread
        }, { timeout: 15_000 })
        .toBe(0)
      await expectLocatorVisible(
        page.locator(
          `[data-yaade-sidebar-session="${selectedId}"][data-yaade-sidebar-session-selected]`,
        ),
      )

      // Toggle lives left of search in the expanded header.
      await expect
        .poll(() =>
          page.evaluate(() => {
            const trigger = document.querySelector(
              '[data-yaade-mission-sidebar] [data-slot="sidebar-trigger"]',
            )
            const search = document.querySelector(
              "[data-yaade-sidebar-search]",
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
            .locator("[data-yaade-mission-sidebar]")
            .getAttribute("data-yaade-sidebar-state"),
        )
        .toBe("collapsed")

      const selectedCompactRow = page.locator(
        "[data-yaade-sidebar-session-selected]",
      )
      const projectMonogram = selectedCompactRow.locator(
        "[data-yaade-sidebar-project-monogram]",
      )
      await expectLocatorVisible(projectMonogram)
      await expect
        .poll(() =>
          projectMonogram.getAttribute(
            "data-yaade-sidebar-project-name",
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
              .locator("[data-yaade-mission-sidebar]")
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
      // Top-left (0,0) sits inside a left floating sidebar — park on the right.
      const awayFromSidebar = async () => {
        const width = await page.evaluate(() => window.innerWidth)
        await page.mouse.move(Math.max(240, width - 24), 48)
      }

      await awayFromSidebar()
      await projectMonogram.hover()
      await expect
        .poll(
          () =>
            page
              .getByRole("tooltip")
              .filter({ hasText: projectName })
              .isVisible(),
          { timeout: 15_000 },
        )
        .toBe(true)

      // Floating island + hover-peek: snappy dwell expands without pinning.
      await expect
        .poll(() =>
          page.evaluate(() => {
            const peer = document.querySelector(
              '[data-slot="sidebar"][data-variant="floating"]',
            )
            return peer?.getAttribute("data-variant") ?? null
          }),
        )
        .toBe("floating")
      await awayFromSidebar()
      await expect
        .poll(() =>
          page
            .locator("[data-yaade-mission-sidebar]")
            .getAttribute("data-yaade-sidebar-peek"),
        )
        .toBe("false")

      const sidebarContainer = page.locator(
        "[data-yaade-mission-sidebar][data-slot='sidebar-container']",
      )
      const peekBox = await sidebarContainer.boundingBox()
      expect(peekBox).toBeTruthy()
      await page.mouse.move(peekBox!.x + 12, peekBox!.y + 48, { steps: 8 })
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const container = document.querySelector(
                "[data-yaade-mission-sidebar]",
              )
              const peer = document.querySelector(
                '[data-slot="sidebar"][data-variant="floating"]',
              )
              return {
                attr: container?.getAttribute("data-yaade-sidebar-peek"),
                peerPeek: peer?.getAttribute("data-peek"),
              }
            }),
          { timeout: 5_000 },
        )
        .toEqual({ attr: "true", peerPeek: "true" })
      await expectSelectorVisible(page, "[data-yaade-sidebar-search]")
      // Peek clears collapsible=icon so session titles are not clipped to icon size.
      await expect
        .poll(() =>
          page.evaluate(() => {
            const peer = document.querySelector(
              '[data-slot="sidebar"][data-peek="true"]',
            )
            const row = document.querySelector(
              "[data-yaade-sidebar-session-selected]",
            )
            if (!peer || !row) return null
            const title = row.textContent?.trim() ?? ""
            return {
              collapsible: peer.getAttribute("data-collapsible") ?? "",
              hasTitle: title.length > 2 && !/^SW$/i.test(title),
              width: row.getBoundingClientRect().width,
            }
          }),
        )
        .toMatchObject({
          collapsible: "",
          hasTitle: true,
        })
      await expect
        .poll(() =>
          page
            .locator("[data-yaade-mission-sidebar]")
            .getAttribute("data-yaade-sidebar-state"),
        )
        .toBe("collapsed")
      await expect
        .poll(() =>
          page.evaluate(() => {
            const raw = localStorage.getItem("jet-appearance-settings")
            if (!raw) return null
            return (JSON.parse(raw) as { sidebarCollapsed?: boolean })
              .sidebarCollapsed
          }),
        )
        .toBe(true)

      // Leave the rail — peek clears; still collapsed.
      await awayFromSidebar()
      await expect
        .poll(
          () =>
            page
              .locator("[data-yaade-mission-sidebar]")
              .getAttribute("data-yaade-sidebar-peek"),
          { timeout: 5_000 },
        )
        .toBe("false")
      await expect
        .poll(() =>
          page
            .locator("[data-yaade-mission-sidebar]")
            .getAttribute("data-yaade-sidebar-state"),
        )
        .toBe("collapsed")

      await page.getByRole("button", { name: "Toggle sidebar" }).first().click()
      await expect
        .poll(() =>
          page
            .locator("[data-yaade-mission-sidebar]")
            .getAttribute("data-yaade-sidebar-state"),
        )
        .toBe("expanded")
      await expect
        .poll(() =>
          page
            .locator("[data-yaade-mission-sidebar]")
            .getAttribute("data-yaade-sidebar-peek"),
        )
        .toBe("false")

      // Re-select project filter and persist (absolute path)
      await projectChip.click()
      const filterPath = await projectChip.getAttribute(
        "data-yaade-sidebar-project-filter-option",
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
      await page.waitForFunction(() => window.__yaadeAgent != null, null, {
        timeout: 30_000,
      })
      await page.evaluate(() => window.__yaadeAgent!.waitForReady())
      await expect
        .poll(() =>
          page.evaluate(
            () => window.__yaadeAgent!.getState().sessionLayout,
          ),
        )
        .toBe("sidebar")
      await expectSelectorVisible(page, "[data-yaade-mission-sidebar]", {
        timeout: 30_000,
      })
      // Catalog restore is async — wait for projects before asserting list.
      await expect
        .poll(
          () =>
            page.evaluate(
              () => window.__yaadeAgent!.listWorkspaces().length,
            ),
          { timeout: 30_000 },
        )
        .toBeGreaterThan(0)
      await expectSelectorVisible(
        page,
        "[data-yaade-sidebar-project-filter]",
        { timeout: 30_000 },
      )
      await expectSelectorVisible(page, "[data-yaade-sidebar-unread-list]", {
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
              .locator("[data-yaade-mission-sidebar]")
              .getAttribute("data-yaade-sidebar-project-filter-active"),
          { timeout: 15_000 },
        )
        .toBe(filterPath)
      await expect
        .poll(() =>
          page
            .locator('[data-yaade-sidebar-project-filter-option="all"]')
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
      await expect
        .poll(() =>
          page.evaluate(
            () => window.__yaadeAgent!.getState().sessionLayout,
          ),
        )
        .toBe("sidebar")
      await page.evaluate(
        path => window.__yaadeAgent!.addWorkspace(path),
        secondPath,
      )
      await expect
        .poll(() =>
          page.evaluate(() => window.__yaadeAgent!.listWorkspaces().length),
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
      await page.waitForFunction(() => window.__yaadeAgent != null, null, {
        timeout: 30_000,
      })
      await page.evaluate(() => window.__yaadeAgent!.waitForReady())
      await expect
        .poll(() =>
          page.evaluate(() => window.__yaadeAgent!.listWorkspaces().length),
        )
        .toBe(2)
      await expectSelectorVisible(
        page,
        '[data-yaade-sidebar-project-filter-option]:not([data-yaade-sidebar-project-filter-option="all"])',
        { timeout: 30_000 },
      )
      const chipCount = await page
        .locator(
          '[data-yaade-sidebar-project-filter-option]:not([data-yaade-sidebar-project-filter-option="all"])',
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
      await expect
        .poll(() =>
          page.evaluate(
            () => window.__yaadeAgent!.getState().sessionLayout,
          ),
        )
        .toBe("sidebar")

      await page.evaluate(
        path => window.__yaadeAgent!.addWorkspace(path),
        secondPath,
      )
      await expect
        .poll(() =>
          page.evaluate(() => window.__yaadeAgent!.listWorkspaces().length),
        )
        .toBe(2)

      await expectSelectorVisible(page, "[data-yaade-sidebar-project-filter]")
      const chip = page.locator(
        '[data-yaade-sidebar-project-filter-option]:not([data-yaade-sidebar-project-filter-option="all"])',
      ).filter({ hasText: "second-workspace" })
      await expectLocatorVisible(chip)
      await chip.click()
      await expect
        .poll(() => chip.getAttribute("data-state"))
        .toBe("on")
      await expect
        .poll(() =>
          page
            .locator("[data-yaade-mission-sidebar]")
            .getAttribute("data-yaade-sidebar-project-filter-active"),
        )
        .toMatch(/second-workspace/)

      await chip.click({ button: "right" })
      const menu = page.locator(
        "[data-yaade-sidebar-project-filter-menu]",
      )
      await expectLocatorVisible(menu)
      await menu.getByRole("menuitem", { name: "Remove project" }).click()

      await expect
        .poll(() =>
          page.evaluate(() =>
            window.__yaadeAgent!.listWorkspaces().map(p => p.name),
          ),
        )
        .not.toContain("second-workspace")
      await expectLocatorCount(chip, 0)
      await expect
        .poll(() =>
          page
            .locator('[data-yaade-sidebar-project-filter-option="all"]')
            .getAttribute("data-state"),
        )
        .toBe("on")
      await expect
        .poll(() =>
          page
            .locator("[data-yaade-mission-sidebar]")
            .getAttribute("data-yaade-sidebar-project-filter-active"),
        )
        .toBe("all")
    } finally {
      await app.close()
    }
  })

  test("Cursor first prompt upgrades sidebar session title", async () => {
    const temporaryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "yaade-sidebar-cursor-title-e2e-"),
    )
    const binDir = path.join(temporaryRoot, "bin")
    fs.mkdirSync(binDir)
    fs.writeFileSync(
      path.join(binDir, "cursor-agent"),
      [
        "#!/bin/sh",
        "printf 'YAADE_CURSOR_TITLE_READY\\r\\n'",
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
      await expectSelectorVisible(page, "[data-yaade-mission-sidebar]")

      await page.locator("[data-yaade-sidebar-new-session]").click()
      await page.locator('[data-yaade-agent-cli-option="cursor"]').click()
      await expectSelectorVisible(
        page,
        '[data-yaade-terminal-modal][data-yaade-session-presentation="inline"]',
        { timeout: 20_000 },
      )

      const sessionRow = page.locator("[data-yaade-sidebar-session]").first()
      await expectLocatorVisible(sessionRow, { timeout: 20_000 })
      const sessionId = await sessionRow.getAttribute(
        "data-yaade-sidebar-session",
      )
      expect(sessionId).toBeTruthy()

      await expect
        .poll(() => sessionRow.textContent(), { timeout: 10_000 })
        .toMatch(/Cursor/i)

      const status = await page.evaluate(
        async ({ sid }) => {
          const url = new URL(
            "/api/v1/notifications/ingest",
            window.location.origin,
          )
          url.searchParams.set("provider", "cursor")
          url.searchParams.set("sessionId", sid!)
          const response = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              hook_event_name: "beforeSubmitPrompt",
              conversation_id: "cursor-title-e2e",
              prompt: "Fix the sidebar title for Cursor",
            }),
          })
          return response.status
        },
        { sid: sessionId },
      )
      expect(status).toBe(204)

      await expect
        .poll(() => sessionRow.textContent(), { timeout: 15_000 })
        .toContain("Fix the sidebar title for Cursor")
    } finally {
      await app.close()
    }
  })
})
