import { expect, test } from "@playwright/test"
import {
  expectLocatorContainsText,
  expectLocatorCount,
  expectLocatorVisible,
  expectSelectorVisible,
} from "../shell/assert.js"
import { hasPtySpawn, launchJet } from "./_launch.js"

const ptyAvailable = hasPtySpawn()

test.describe("project session agents", () => {
  test.skip(!ptyAvailable, "node-pty cannot spawn a shell on this machine")

  test("a selected agent uses its active driver inside the shared five-tool session", async () => {
    const { app, page } = await launchJet({ env: { GHARARGAH_AGENT_MOCK: "1" } })
    try {
      const catalog = await page.evaluate(() => window.gharargah!.agents!.listAgents())
      expect(catalog.agents.map(agent => agent.id)).toEqual([
        "codex",
        "claude",
        "opencode",
        "cursor",
      ])
      for (const agent of catalog.agents) {
        expect(agent.enabled).toBe(true)
        const driverKind = agent.id === "cursor" ? "acp" : "cli"
        const driverId = `${agent.id}:${driverKind}`
        expect(agent.activeDriverId).toBe(driverId)
        expect(agent.drivers).toEqual([
          expect.objectContaining({ id: driverId, kind: driverKind, status: "ready" }),
        ])
      }

      const launcher = page.getByRole("button", { name: "New session" }).first()
      await launcher.click()
      await page.getByRole("menuitem", { name: "Cursor Agent" }).click()

      const modal = page.locator("[data-gharargah-terminal-modal]")
      await expectLocatorVisible(modal)
      await expect.poll(() => modal.getAttribute("data-gharargah-session-mode")).toBe("agent")
      await expectLocatorCount(modal.locator("[data-gharargah-session-mode-tab]"), 5)
      await expectSelectorVisible(page, '[data-gharargah-session-mode-tab="agent"][data-active]')
      await expectLocatorContainsText(modal, "Cursor")

      const composer = modal.locator('[data-testid="composer-editor"]')
      await expectLocatorVisible(composer, { timeout: 20_000 })
      await composer.fill("Confirm the session driver")
      await modal.getByRole("button", { name: "Send message" }).click()
      await expectLocatorContainsText(modal, "Confirm the session driver")
      await expect
        .poll(() => modal.textContent(), { timeout: 20_000 })
        .toContain("Mock agent reply: Confirm the session driver")

      const persisted = await page.evaluate(async () => {
        const raw = localStorage.getItem("gharargah-session-roster-v2")
        if (!raw) return null
        const roster = JSON.parse(raw) as {
          version: number
          sessions: Array<{
            agentId?: string
            agentDriverId?: string
            agentThreadId?: string
          }>
          modal?: { sessionMode?: string }
        }
        const session = roster.sessions[0]
        return {
          version: roster.version,
          mode: roster.modal?.sessionMode,
          agentId: session?.agentId,
          driverId: session?.agentDriverId,
          threadId: session?.agentThreadId,
        }
      })
      expect(persisted).toEqual({
        version: 2,
        mode: "agent",
        agentId: "cursor",
        driverId: "cursor:acp",
        threadId: expect.any(String),
      })

      for (const mode of ["terminal", "editor", "git", "todos"] as const) {
        await modal.locator(`[data-gharargah-session-mode-tab="${mode}"]`).click()
        await expectSelectorVisible(
          page,
          `[data-gharargah-session-mode-tab="${mode}"][data-active]`,
        )
        await expectLocatorCount(modal.locator(`[data-gharargah-session-pane="${mode}"][data-active]`), 1)
      }
    } finally {
      await app.close()
    }
  })
})
