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

  test("Cursor (ACP) opens the agent tab; CLI agents stay in terminal", async () => {
    const { app, page } = await launchJet({ env: { GHARARGAH_AGENT_MOCK: "1" } })
    try {
      const catalog = await page.evaluate(() => window.gharargah!.agents!.listAgents())
      expect(catalog.agents.map(agent => agent.id)).toEqual([
        "codex",
        "claude",
        "opencode",
        "cursor",
        "cursor-acp",
      ])
      for (const agent of catalog.agents) {
        expect(agent.enabled).toBe(true)
        if (agent.id === "cursor-acp") {
          expect(agent.activeDriverId).toBe("cursor:acp")
          expect(agent.drivers).toEqual([
            expect.objectContaining({ id: "cursor:acp", kind: "acp", status: "ready" }),
          ])
        } else {
          const driverId = `${agent.id}:cli`
          expect(agent.activeDriverId).toBe(driverId)
          expect(agent.drivers).toEqual([
            expect.objectContaining({ id: driverId, kind: "cli", status: "ready" }),
          ])
        }
        expect(agent.models.length).toBeGreaterThan(0)
        expect(agent.models[0]).toEqual(
          expect.objectContaining({ slug: expect.any(String), name: expect.any(String) }),
        )
      }

      // CLI Cursor Agent → terminal only, launches cursor-agent, no Agent tab.
      const launcher = page.getByRole("button", { name: "New session" }).first()
      await launcher.click()
      await page.getByRole("menuitem", { name: "Cursor Agent" }).click()

      const modal = page.locator("[data-gharargah-terminal-modal]")
      await expectLocatorVisible(modal)
      await expect.poll(() => modal.getAttribute("data-gharargah-session-mode")).toBe("terminal")
      await expectLocatorCount(modal.locator("[data-gharargah-session-mode-tab]"), 4)
      await expectLocatorCount(modal.locator('[data-gharargah-session-mode-tab="agent"]'), 0)
      await page.locator("[data-gharargah-terminal-modal-close]").click()
      await expectLocatorCount(modal, 0)

      // Cursor (ACP) → agent tab + ACP driver.
      await launcher.click()
      await page.getByRole("menuitem", { name: "Cursor (ACP)" }).click()

      await expectLocatorVisible(modal)
      await expect.poll(() => modal.getAttribute("data-gharargah-session-mode")).toBe("agent")
      await expectLocatorCount(modal.locator("[data-gharargah-session-mode-tab]"), 5)
      await expectSelectorVisible(page, '[data-gharargah-session-mode-tab="agent"][data-active]')
      await expectLocatorContainsText(modal, "Cursor (ACP)")

      const modelPicker = modal.locator('[data-chat-provider-model-picker="true"]')
      await expectLocatorVisible(modelPicker)
      await modelPicker.click()
      // type=submit inside the composer form used to reload the page — session chrome must survive.
      await expectLocatorVisible(page.locator("[data-gharargah-terminal-modal]"))
      await expectLocatorContainsText(modal, "Auto")

      const composer = modal.locator('[data-testid="composer-editor"]')
      await expectLocatorVisible(composer, { timeout: 20_000 })
      // Click composer to close any open picker without Escape (Escape closes the session modal).
      await composer.click()
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
        const session = roster.sessions.find(item => item.agentId === "cursor-acp") ?? roster.sessions[0]
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
        agentId: "cursor-acp",
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
