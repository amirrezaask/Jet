import { expect, test } from "@playwright/test"
import {
  expectLocatorContainsText,
  expectLocatorCount,
  expectLocatorVisible,
  expectSelectorVisible,
} from "../shell/assert.js"
import {
  hasCursorAgent,
  hasPtySpawn,
  launchJet,
  openNewAgentSession,
  openNewCliSession,
  ensureCardsLayout,
} from "./_launch.js"

const ptyAvailable = hasPtySpawn()
const cursorAgentAvailable = hasCursorAgent()

const MOCK_CLI_SESSION_ID = "11111111-1111-4111-8111-111111111111"

type ServerSessionRoster = {
  sessions: Array<{
    ptyId?: string
    status: string
    tabId: string
    agentCliSessionId?: string
    launchArgs?: string[]
  }>
}

async function fetchSessionRoster(page: import("@playwright/test").Page): Promise<ServerSessionRoster | null> {
  return page.evaluate(async () => {
    const res = await fetch("/api/v1/sessions")
    if (!res.ok) return null
    return (await res.json()) as ServerSessionRoster
  })
}

test.describe("session refresh persistence", () => {
  test.skip(!ptyAvailable, "node-pty cannot spawn a shell on this machine")

  test("home agent session card survives reload and resumes CLI session", async () => {
    const { app, page } = await launchJet()
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
      await expectSelectorVisible(page, "[data-gharargah-terminal-panel]", { timeout: 20_000 })

      const cards = section.locator("[data-gharargah-terminal-card]:not([data-gharargah-new-session])")
      await expectLocatorVisible(cards.first())

      let tabId = ""
      await expect
        .poll(async () => {
          const roster = await fetchSessionRoster(page)
          tabId = roster?.sessions[0]?.tabId ?? ""
          return tabId || null
        }, { timeout: 20_000 })
        .toBeTruthy()

      await page.evaluate(
        async ({ sessionId, providerSessionId }) => {
          await window.gharargah!.notifications.ingest({
            source: "provider-hook",
            provider: "codex",
            type: "session-started",
            title: "Codex session started",
            sessionId,
            providerSessionId,
          })
        },
        { sessionId: tabId, providerSessionId: MOCK_CLI_SESSION_ID },
      )

      await expect
        .poll(async () => {
          const roster = await fetchSessionRoster(page)
          return roster?.sessions[0]?.agentCliSessionId ?? null
        }, { timeout: 20_000 })
        .toBe(MOCK_CLI_SESSION_ID)

      await page.locator("[data-gharargah-terminal-modal-close]").click()
      await expectLocatorCount(page.locator("[data-gharargah-terminal-modal]"), 0)
      await expectLocatorVisible(cards.first())

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
        /Running|Idle|Starting|Failed/,
      )

      const rosterAfter = await fetchSessionRoster(page)
      expect(rosterAfter?.sessions[0]?.agentCliSessionId).toBe(MOCK_CLI_SESSION_ID)
      expect(rosterAfter?.sessions[0]?.ptyId).toBeFalsy()
      expect(rosterAfter?.sessions[0]?.launchArgs?.slice(0, 2)).toEqual([
        "resume",
        MOCK_CLI_SESSION_ID,
      ])

      await cardsAfter.first().click()
      await expectSelectorVisible(page, "[data-gharargah-terminal-modal]", { timeout: 20_000 })
      await expectSelectorVisible(page, "[data-gharargah-terminal-panel]", { timeout: 20_000 })
      await expectSelectorVisible(page, "[data-gharargah-terminal-panel] .xterm", { timeout: 20_000 })
    } finally {
      await app.close()
    }
  })

  test("cursor agent CLI launches with --trust and stays running", async () => {
    test.skip(!cursorAgentAvailable, "cursor-agent not on PATH")
    const { app, page } = await launchJet()
    try {
      await ensureCardsLayout(page)
      await expectSelectorVisible(page, "[data-gharargah-home]")
      await openNewCliSession(page, "cursor")
      await expectSelectorVisible(page, "[data-gharargah-terminal-panel] .xterm", {
        timeout: 20_000,
      })

      await expect
        .poll(async () => {
          const roster = await fetchSessionRoster(page)
          return roster?.sessions[0]?.launchArgs ?? null
        }, { timeout: 20_000 })
        .toEqual(["--trust"])

      // Trust prompt Quit used to surface as "Process exited with code 1".
      await page.waitForTimeout(1500)
      await expectLocatorCount(page.locator("[data-gharargah-terminal-exit-bar]"), 0)
    } finally {
      await app.close()
    }
  })
})
