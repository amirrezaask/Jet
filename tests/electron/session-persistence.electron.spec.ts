import { expect, test } from "@playwright/test"
import {
  expectLocatorContainsText,
  expectLocatorCount,
  expectLocatorVisible,
  expectSelectorVisible,
} from "../shell/assert.js"
import { hasPtySpawn, launchJet } from "./_launch.js"

const SESSION_ROSTER_STORAGE_KEY = "gharargah-session-roster-v2"
const ptyAvailable = hasPtySpawn()

test.describe("session refresh persistence", () => {
  test.skip(!ptyAvailable, "node-pty cannot spawn a shell on this machine")

  test("home terminal session card survives reload and reattaches", async () => {
    const { app, page } = await launchJet()
    try {
      await expectSelectorVisible(page, "[data-gharargah-home]")
      const state = await page.evaluate(() => window.__gharargahAgent!.getState())
      const workspaceName = state.workspaces[0]?.name ?? "sample-workspace"
      const section = page.locator(
        `[data-gharargah-project-section][data-gharargah-project-name="${workspaceName}"]`,
      )
      await expectLocatorVisible(section)

      await section.getByRole("button", { name: "New session" }).click()
      await page
        .locator('[data-slot="dropdown-menu-content"] [data-slot="dropdown-menu-item"]', {
          hasText: "Blank session",
        })
        .click()
      await expectSelectorVisible(page, "[data-gharargah-terminal-modal]", { timeout: 20_000 })
      await expectSelectorVisible(page, "[data-gharargah-terminal-panel]", { timeout: 20_000 })

      const cards = section.locator("[data-gharargah-terminal-card]:not([data-gharargah-new-session])")
      await expectLocatorVisible(cards.first())
      await expect
        .poll(async () => {
          const roster = await page.evaluate(key => {
            const raw = localStorage.getItem(key)
            if (!raw) return null
            return JSON.parse(raw) as {
              sessions: Array<{ ptyId?: string; status: string }>
            }
          }, SESSION_ROSTER_STORAGE_KEY)
          const session = roster?.sessions[0]
          return session?.ptyId && session.status === "running" ? session.ptyId : null
        }, { timeout: 20_000 })
        .toBeTruthy()

      const ptyIdBefore = await page.evaluate(key => {
        const raw = localStorage.getItem(key)
        if (!raw) return null
        return (JSON.parse(raw) as { sessions: Array<{ ptyId?: string }> }).sessions[0]?.ptyId ?? null
      }, SESSION_ROSTER_STORAGE_KEY)

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

      const ptyIdAfter = await page.evaluate(key => {
        const raw = localStorage.getItem(key)
        if (!raw) return null
        return (JSON.parse(raw) as { sessions: Array<{ ptyId?: string }> }).sessions[0]?.ptyId ?? null
      }, SESSION_ROSTER_STORAGE_KEY)
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
