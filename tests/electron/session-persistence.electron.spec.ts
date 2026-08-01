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
  openNewCliSession,
  ensureCardsLayout,
} from "./_launch.js"

const ptyAvailable = hasPtySpawn()

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
          // SessionStart-shaped Claude hook → ADE path stores native id immediately.
          const res = await fetch(
            `/api/v1/notifications/ingest?provider=claude&sessionId=${encodeURIComponent(sessionId)}`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                hook_event_name: "SessionStart",
                session_id: providerSessionId,
                source: "startup",
              }),
            },
          )
          if (!res.ok && res.status !== 204) {
            await window.gharargah!.notifications.ingest({
              source: "provider-hook",
              provider: "codex",
              type: "session-started",
              title: "Codex session started",
              sessionId,
              providerSessionId,
            })
          }
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

  test("cursor agent CLI opens instantly, stores after hook session id, resumes", async () => {
    const temporaryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "gharargah-cursor-session-e2e-"),
    )
    const binDir = path.join(temporaryRoot, "bin")
    fs.mkdirSync(binDir)
    fs.writeFileSync(
      path.join(binDir, "cursor-agent"),
      [
        "#!/bin/sh",
        `printf '{"session_id":"${MOCK_CLI_SESSION_ID}"}\\r\\n'`,
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

      await openNewCliSession(page, "cursor")
      // Modal + interactive PTY open immediately — no create-chat defer gate.
      await expectSelectorVisible(page, "[data-gharargah-terminal-modal]", {
        timeout: 10_000,
      })
      await expectLocatorCount(
        page.locator("[data-gharargah-terminal-defer-pty='1']"),
        0,
      )
      await expectSelectorVisible(page, "[data-gharargah-terminal-panel] .xterm", {
        timeout: 20_000,
      })

      // Roster deferred until hooks / native session id arrive.
      let chatId = ""
      await expect
        .poll(async () => {
          const roster = await fetchSessionRoster(page)
          const session = roster?.sessions[0]
          const args = session?.launchArgs ?? null
          const id = session?.agentCliSessionId ?? null
          if (!args || !id) return null
          if (args[0] !== `--resume=${id}`) return null
          if (!args.includes("--trust")) return null
          return id
        }, { timeout: 45_000 })
        .toBeTruthy()

      const rosterBefore = await fetchSessionRoster(page)
      chatId = rosterBefore?.sessions[0]?.agentCliSessionId ?? ""
      expect(chatId).toBeTruthy()

      // Trust prompt Quit used to surface as "Process exited with code 1".
      await page.waitForTimeout(1500)
      await expectLocatorCount(page.locator("[data-gharargah-terminal-exit-bar]"), 0)

      await page.locator("[data-gharargah-terminal-modal-close]").click()
      await expectLocatorCount(page.locator("[data-gharargah-terminal-modal]"), 0)

      await page.reload()
      await page.waitForFunction(() => window.__gharargahAgent != null, null, {
        timeout: 30_000,
      })
      await page.evaluate(() => window.__gharargahAgent!.waitForReady())
      await expectSelectorVisible(page, "[data-gharargah-home]")

      const sectionAfter = page.locator(
        `[data-gharargah-project-section][data-gharargah-project-name="${workspaceName}"]`,
      )
      const cardsAfter = sectionAfter.locator(
        "[data-gharargah-terminal-card]:not([data-gharargah-new-session])",
      )
      await expectLocatorVisible(cardsAfter.first())

      const rosterAfter = await fetchSessionRoster(page)
      expect(rosterAfter?.sessions[0]?.agentCliSessionId).toBe(chatId)
      expect(rosterAfter?.sessions[0]?.ptyId).toBeFalsy()
      expect(rosterAfter?.sessions[0]?.launchArgs?.[0]).toBe(`--resume=${chatId}`)
      expect(rosterAfter?.sessions[0]?.launchArgs).toContain("--trust")

      await cardsAfter.first().click()
      await expectSelectorVisible(page, "[data-gharargah-terminal-modal]", {
        timeout: 20_000,
      })
      await expectSelectorVisible(page, "[data-gharargah-terminal-panel] .xterm", {
        timeout: 20_000,
      })
      await expectLocatorCount(page.locator("[data-gharargah-terminal-exit-bar]"), 0)
    } finally {
      await app.close()
    }
  })
})
