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
import { hasPtySpawn, launchJet, openNewAgentSession, ensureCardsLayout, execCommand } from "./_launch.js"

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
      path.join(os.tmpdir(), "gharargah-archive-transcript-e2e-"),
    )
    const binDir = path.join(temporaryRoot, "bin")
    const transcriptMarker = "GHARARGAH_ARCHIVE_TRANSCRIPT_MARKER"
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
      await ensureCardsLayout(page)
      await expectSelectorVisible(page, "[data-gharargah-home]")
      const state = await page.evaluate(() => window.__gharargahAgent!.getState())
      const workspaceName = state.workspaces[0]?.name ?? "sample-workspace"
      const section = page.locator(
        `[data-gharargah-project-section][data-gharargah-project-name="${workspaceName}"]`,
      )
      await expectLocatorVisible(section)

      await openNewAgentSession(page)
      await expectSelectorVisible(page, "[data-gharargah-terminal-modal]", { timeout: 20_000 })
      await expectLocatorContainsText(
        page.locator("[data-gharargah-terminal-panel] .xterm-rows"),
        transcriptMarker,
      )

      const cards = section.locator("[data-gharargah-terminal-card]:not([data-gharargah-new-session])")
      await expectLocatorVisible(cards.first())

      let rosterBefore: ServerSessionRoster | null = null
      await expect
        .poll(async () => {
          rosterBefore = await fetchSessionRoster(page)
          return rosterBefore?.sessions.length ?? 0
        }, { timeout: 20_000 })
        .toBeGreaterThan(0)
      const sessionBefore = rosterBefore!.sessions[0]!

      await page.locator("[data-gharargah-terminal-modal-close]").click()
      await expectLocatorCount(page.locator("[data-gharargah-terminal-modal]"), 0)

      await execCommand(page, "ui.setSessionLayout.sidebar")
      const activeRow = page.locator(
        `[data-gharargah-sidebar-session-section="active"] [data-gharargah-sidebar-session="${sessionBefore.tabId}"]`,
      )
      await expectLocatorVisible(activeRow, { timeout: 15_000 })
      await activeRow.locator('[aria-label="Session actions"]').click()
      await page.locator("[data-gharargah-sidebar-session-archive]").click()
      await expectLocatorVisible(
        page.locator(
          `[data-gharargah-sidebar-session-section="archived"] [data-gharargah-sidebar-session="${sessionBefore.tabId}"]`,
        ),
      )

      await execCommand(page, "ui.setSessionLayout.cards")
      await expectLocatorVisible(cards.first())
      await expectLocatorContainsText(
        cards.first().locator("[data-gharargah-status-badge]"),
        "Archived",
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
      await page.waitForFunction(() => window.__gharargahAgent != null, null, { timeout: 30_000 })
      await page.evaluate(() => window.__gharargahAgent!.waitForReady())
      await expectSelectorVisible(page, "[data-gharargah-home]")

      const sectionAfter = page.locator(
        `[data-gharargah-project-section][data-gharargah-project-name="${workspaceName}"]`,
      )
      const cardsAfter = sectionAfter.locator(
        "[data-gharargah-terminal-card]:not([data-gharargah-new-session])",
      )
      await expectLocatorVisible(cardsAfter.first())
      await expectLocatorContainsText(
        cardsAfter.first().locator("[data-gharargah-status-badge]"),
        "Archived",
      )

      // The card is replaced by the modal as part of the click. Dispatch the
      // semantic click directly so Playwright does not retry against a node
      // that intentionally disappears mid-action.
      await cardsAfter.first().evaluate((card: HTMLElement) => card.click())
      await expectSelectorVisible(page, "[data-gharargah-terminal-modal]", { timeout: 20_000 })
      await expect
        .poll(() =>
          page.locator("[data-gharargah-terminal-modal]").getAttribute(
            "data-gharargah-session-mode",
          ),
        )
        .toBe("agent")
      await expectLocatorVisible(
        page.locator("[data-gharargah-terminal-archived]"),
      )
      await expectLocatorContainsText(
        page.locator("[data-gharargah-terminal-panel] .xterm-rows"),
        transcriptMarker,
      )
      await expectLocatorVisible(
        page.locator("[data-gharargah-session-resume-archived]"),
      )
      await expectLocatorContainsText(
        page.locator("[data-gharargah-terminal-modal-title]"),
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
            .locator("[data-gharargah-terminal-panel]")
            .getAttribute("data-gharargah-terminal-pty-id"),
        )
        .toBe("")
      await expectLocatorCount(page.locator("[data-gharargah-session-archive]"), 0)

      await page.locator("[data-gharargah-terminal-modal-close]").click()
      await expectLocatorCount(page.locator("[data-gharargah-terminal-modal]"), 0)

      await execCommand(page, "ui.setSessionLayout.sidebar")
      await expect
        .poll(async () => page.evaluate(() => window.__gharargahAgent!.getState().sessionLayout), {
          timeout: 10_000,
        })
        .toBe("sidebar")

      await expectLocatorVisible(page.locator("[data-gharargah-mission-sidebar]"))
      const activeSection = page.locator(
        '[data-gharargah-sidebar-section-label="active"]',
      )
      await expectLocatorVisible(activeSection, { timeout: 15_000 })
      await expectLocatorContainsText(activeSection, "Active")
      const archivedSection = page.locator(
        '[data-gharargah-sidebar-section-label="archived"]',
      )
      await expectLocatorVisible(archivedSection, { timeout: 15_000 })
      await expectLocatorContainsText(archivedSection, "Archived")
      await expectLocatorVisible(
        page.locator(
          '[data-gharargah-sidebar-session-section="archived"] [data-gharargah-sidebar-session]',
        ).first(),
      )

      const archivedRow = page.locator(
        `[data-gharargah-sidebar-session-section="archived"] [data-gharargah-sidebar-session="${sessionBefore.tabId}"]`,
      )
      await archivedRow.click()
      await expectLocatorVisible(
        page.locator("[data-gharargah-session-resume-archived]"),
      )
      await page.locator("[data-gharargah-session-resume-archived]").click()
      await expectLocatorCount(
        page.locator("[data-gharargah-terminal-archived]"),
        0,
      )
      await expect
        .poll(async () => {
          const roster = await fetchSessionRoster(page)
          return roster?.sessions[0]?.doneAt ?? null
        }, { timeout: 20_000 })
        .toBeNull()
      await expectLocatorContainsText(
        page.locator("[data-gharargah-terminal-modal-title]"),
        archivedRoster?.sessions[0]?.agentTitle ?? sessionBefore.label,
      )
    } finally {
      await app.close()
      fs.rmSync(temporaryRoot, { recursive: true, force: true })
    }
  })
})
