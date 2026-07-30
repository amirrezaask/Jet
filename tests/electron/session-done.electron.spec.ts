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
  sessions: Array<{ ptyId?: string; status: string; tabId: string; doneAt?: string }>
}

async function fetchSessionRoster(page: import("@playwright/test").Page): Promise<ServerSessionRoster | null> {
  return page.evaluate(async () => {
    const res = await fetch("/api/v1/sessions")
    if (!res.ok) return null
    return (await res.json()) as ServerSessionRoster
  })
}

test.describe("session done persistence", () => {
  test.skip(!ptyAvailable, "node-pty cannot spawn a shell on this machine")

  test("mark done keeps session card after reload", async () => {
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

      const cards = section.locator("[data-gharargah-terminal-card]:not([data-gharargah-new-session])")
      await expectLocatorVisible(cards.first())

      await page.locator("[data-gharargah-session-mark-done]").click()
      await expectLocatorCount(page.locator("[data-gharargah-terminal-modal]"), 0)
      await expectLocatorVisible(cards.first())
      await expectLocatorContainsText(
        cards.first().locator("[data-gharargah-status-badge]"),
        "Done",
      )

      await expect
        .poll(async () => {
          const roster = await fetchSessionRoster(page)
          return roster?.sessions[0]?.doneAt ?? null
        }, { timeout: 20_000 })
        .toBeTruthy()

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
        "Done",
      )

      await cardsAfter.first().click()
      await expectSelectorVisible(page, "[data-gharargah-terminal-modal]", { timeout: 20_000 })
      await expectSelectorVisible(page, "[data-gharargah-terminal-panel] .xterm", { timeout: 20_000 })
      await expectLocatorCount(page.locator("[data-gharargah-session-mark-done]"), 0)
    } finally {
      await app.close()
    }
  })
})
