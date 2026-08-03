import { expect, test } from "@playwright/test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  expectLocatorContainsText,
  expectLocatorCount,
  expectLocatorVisible,
  expectSelectorVisible,
} from "../shell/assert.js"
import {
  hasPtySpawn,
  launchJet,
  openNewAgentSession,
  ensureSidebarLayout,
  execCommand,
  waitForTerminalText,
} from "./_launch.js"

const ptyAvailable = hasPtySpawn()

type ServerSessionRoster = {
  version: 2
  sessions: Array<{
    ptyId?: string
    status: string
    tabId: string
    cwdRootUri: string
    label: string
    launchCommand?: string
    agentId?: string
    agentTitle?: string
    doneAt?: string
    transcript?: string
  }>
  modal: { tabId: string; sessionMode: string } | null
}

async function fetchSessionRoster(page: import("@playwright/test").Page): Promise<ServerSessionRoster | null> {
  return page.evaluate(async () => {
    const res = await fetch("/api/v1/sessions")
    if (!res.ok) return null
    return (await res.json()) as ServerSessionRoster
  })
}

test.describe("session archive persistence", () => {
  test.skip(!ptyAvailable, "node-pty cannot spawn a shell on this machine")

  test("archive preserves the session and moves it from Active to Archived", async () => {
    const temporaryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "yaade-archive-transcript-e2e-"),
    )
    const binDir = path.join(temporaryRoot, "bin")
    const transcriptMarker = "YAADE_ARCHIVE_TRANSCRIPT_MARKER"
    fs.mkdirSync(binDir)
    fs.writeFileSync(
      path.join(binDir, "codex"),
      [
        "#!/bin/sh",
        `printf "${transcriptMarker}\\r\\n"`,
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
      await ensureSidebarLayout(page)
      await expectSelectorVisible(page, "[data-yaade-mission-sidebar]")

      await openNewAgentSession(page)
      await expectSelectorVisible(page, "[data-yaade-terminal-modal]", {
        timeout: 20_000,
      })
      await waitForTerminalText(page, transcriptMarker)

      let rosterBefore: ServerSessionRoster | null = null
      await expect
        .poll(async () => {
          rosterBefore = await fetchSessionRoster(page)
          return rosterBefore?.sessions.length ?? 0
        }, { timeout: 20_000 })
        .toBeGreaterThan(0)
      const sessionBefore = rosterBefore!.sessions[0]!

      await execCommand(page, "yaade.goHome")
      await expectLocatorCount(page.locator("[data-yaade-terminal-modal]"), 0)

      const activeRow = page.locator(
        `[data-yaade-sidebar-session-section="active"] [data-yaade-sidebar-session-row="${sessionBefore.tabId}"]`,
      )
      await expectLocatorVisible(
        activeRow.locator(`[data-yaade-sidebar-session="${sessionBefore.tabId}"]`),
        { timeout: 15_000 },
      )
      await activeRow.hover()
      await activeRow.locator("[data-yaade-sidebar-session-archive]").click()
      const archivedToggle = page.locator(
        '[data-yaade-sidebar-section-toggle="archived"]',
      )
      await expectLocatorVisible(archivedToggle, { timeout: 15_000 })
      await expect
        .poll(() => archivedToggle.getAttribute("data-state"))
        .toBe("closed")
      await archivedToggle.click()
      await expect
        .poll(() => archivedToggle.getAttribute("data-state"))
        .toBe("open")
      await expectLocatorVisible(
        page.locator(
          `[data-yaade-sidebar-session-section="archived"] [data-yaade-sidebar-session="${sessionBefore.tabId}"]`,
        ),
      )

      let archivedRoster: ServerSessionRoster | null = null
      await expect
        .poll(async () => {
          archivedRoster = await fetchSessionRoster(page)
          return archivedRoster?.sessions[0]?.doneAt ?? null
        }, { timeout: 20_000 })
        .toBeTruthy()
      expect(archivedRoster?.sessions).toHaveLength(1)
      expect(archivedRoster?.sessions[0]).toEqual(
        expect.objectContaining({
          tabId: sessionBefore.tabId,
          cwdRootUri: sessionBefore.cwdRootUri,
          label: sessionBefore.label,
          launchCommand: sessionBefore.launchCommand,
          agentId: sessionBefore.agentId,
          agentTitle: sessionBefore.agentTitle,
        }),
      )

      await page.reload()
      await page.waitForFunction(() => window.__yaadeAgent != null, null, {
        timeout: 30_000,
      })
      await page.evaluate(() => window.__yaadeAgent!.waitForReady())
      await ensureSidebarLayout(page)
      await expectSelectorVisible(page, "[data-yaade-mission-sidebar]")

      const archivedToggleAfterReload = page.locator(
        '[data-yaade-sidebar-section-toggle="archived"]',
      )
      await expectLocatorVisible(archivedToggleAfterReload, { timeout: 15_000 })
      await expect
        .poll(() => archivedToggleAfterReload.getAttribute("data-state"))
        .toBe("closed")
      await archivedToggleAfterReload.click()
      const archivedRow = page.locator(
        `[data-yaade-sidebar-session-section="archived"] [data-yaade-sidebar-session="${sessionBefore.tabId}"]`,
      )
      await expectLocatorVisible(archivedRow, { timeout: 15_000 })
      // Archived rows live under the archived section; runtime status stays
      // disconnected/exited until resume (ADE card statuses are gone).

      await archivedRow.click()
      await expectSelectorVisible(page, "[data-yaade-terminal-modal]", {
        timeout: 20_000,
      })
      await expect
        .poll(() =>
          page
            .locator("[data-yaade-terminal-modal]")
            .getAttribute("data-yaade-session-mode"),
        )
        .toBe("agent")
      await expectLocatorVisible(
        page.locator("[data-yaade-terminal-archived]"),
      )
      await waitForTerminalText(page, transcriptMarker)
      await expectLocatorVisible(
        page.locator("[data-yaade-session-resume-archived]"),
      )
      await expectLocatorContainsText(
        page.locator("[data-yaade-terminal-modal-title]"),
        archivedRoster?.sessions[0]?.agentTitle ?? sessionBefore.label,
      )
      // Merely viewing history is read-only and must not reactivate/spawn it.
      await expect
        .poll(async () => {
          const roster = await fetchSessionRoster(page)
          return roster?.sessions[0]?.doneAt ?? null
        })
        .toBeTruthy()
      await expect
        .poll(() =>
          page
            .locator("[data-yaade-terminal-panel]")
            .getAttribute("data-yaade-terminal-pty-id"),
        )
        .toBe("")
      await expectLocatorCount(page.locator("[data-yaade-session-archive]"), 0)

      await expectLocatorVisible(page.locator("[data-yaade-mission-sidebar]"))
      const activeSection = page.locator(
        '[data-yaade-sidebar-section-label="active"]',
      )
      await expectLocatorVisible(activeSection, { timeout: 15_000 })
      await expectLocatorContainsText(activeSection, "Active")
      const archivedSection = page.locator(
        '[data-yaade-sidebar-section-label="archived"]',
      )
      await expectLocatorVisible(archivedSection, { timeout: 15_000 })
      await expectLocatorContainsText(archivedSection, "Archived")
      await expect
        .poll(() =>
          page
            .locator('[data-yaade-sidebar-section-toggle="archived"]')
            .getAttribute("data-state"),
        )
        .toBe("open")
      await expectLocatorVisible(
        page
          .locator(
            '[data-yaade-sidebar-session-section="archived"] [data-yaade-sidebar-session]',
          )
          .first(),
      )

      await page.locator("[data-yaade-session-resume-archived]").click()
      await expectLocatorCount(
        page.locator("[data-yaade-terminal-archived]"),
        0,
      )
      await expect
        .poll(async () => {
          const roster = await fetchSessionRoster(page)
          return roster?.sessions[0]?.doneAt ?? null
        }, { timeout: 20_000 })
        .toBeNull()
      await expectLocatorContainsText(
        page.locator("[data-yaade-terminal-modal-title]"),
        archivedRoster?.sessions[0]?.agentTitle ?? sessionBefore.label,
      )
    } finally {
      await app.close()
      fs.rmSync(temporaryRoot, { recursive: true, force: true })
    }
  })
})
