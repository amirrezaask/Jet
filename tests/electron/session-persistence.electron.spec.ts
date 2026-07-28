import { expect, test } from "@playwright/test"
import {
  expectLocatorContainsText,
  expectLocatorCount,
  expectLocatorVisible,
  expectSelectorVisible,
} from "../shell/assert.js"
import { hasPtySpawn, launchJet, openNewAgentSession, ensureCardsLayout } from "./_launch.js"

const ptyAvailable = hasPtySpawn()

type ServerSessionRoster = {
  sessions: Array<{ ptyId?: string; status: string; tabId: string }>
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

  test("home terminal session card survives reload and reattaches", async () => {
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
      await expect
        .poll(async () => {
          const roster = await fetchSessionRoster(page)
          const session = roster?.sessions[0]
          return session?.ptyId && session.status === "running" ? session.ptyId : null
        }, { timeout: 20_000 })
        .toBeTruthy()

      const ptyIdBefore = (await fetchSessionRoster(page))?.sessions[0]?.ptyId ?? null

      // Client catalog is server-backed — no localStorage roster.
      await expect
        .poll(() =>
          page.evaluate(() => localStorage.getItem("gharargah-session-roster-v2")),
        )
        .toBeNull()

      await page.keyboard.press("Escape")
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
        /Running|Idle|Failed/,
      )

      const ptyIdAfter = (await fetchSessionRoster(page))?.sessions[0]?.ptyId ?? null
      expect(ptyIdAfter).toBe(ptyIdBefore)

      await cardsAfter.first().click()
      await expectSelectorVisible(page, "[data-gharargah-terminal-modal]", { timeout: 20_000 })
      await expectSelectorVisible(page, "[data-gharargah-terminal-panel]", { timeout: 20_000 })
      await expectSelectorVisible(page, "[data-gharargah-terminal-panel] .xterm", { timeout: 20_000 })
    } finally {
      await app.close()
    }
  })
})
