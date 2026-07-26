import { expect, test } from "@playwright/test"
import {
  expectLocatorContainsText,
  expectLocatorCount,
  expectLocatorVisible,
  expectSelectorVisible,
} from "../shell/assert.js"
import { hasPtySpawn, launchJet, openNewAgentSession } from "./_launch.js"

const ptyAvailable = hasPtySpawn()
/** Agent chat is enabled by default; 0 builds the recovery-only terminal surface. */
const agentChatE2e = process.env.GHARARGAH_ENABLE_AGENT_CHAT !== "0"

test.describe("project session agent chat", () => {
  test.skip(!ptyAvailable, "node-pty cannot spawn a shell on this machine")
  test.skip(
    !agentChatE2e,
    "disabled in GHARARGAH_ENABLE_AGENT_CHAT=0 recovery builds",
  )

  test("New session opens agent chat; providers bind via model picker", async () => {
    const { app, page } = await launchJet({ env: { GHARARGAH_AGENT_MOCK: "1" } })
    try {
      const catalog = await page.evaluate(() => window.gharargah!.agents!.listAgents())
      expect(catalog.agents.map(agent => agent.id)).toEqual([
        "codex",
        "claude",
        "opencode",
        "cursor",
        "grok",
      ])
      for (const agent of catalog.agents) {
        expect(agent.enabled).toBe(true)
        if (agent.id === "grok") {
          expect(agent.activeDriverId).toBe("grok:acp")
          expect(agent.drivers).toEqual([
            expect.objectContaining({ id: "grok:acp", kind: "acp", status: "ready" }),
          ])
        } else if (agent.id === "codex") {
          expect(agent.activeDriverId).toBe("codex:app-server")
          expect(agent.drivers).toEqual([
            expect.objectContaining({ id: "codex:cli", kind: "cli", status: "ready" }),
            expect.objectContaining({
              id: "codex:app-server",
              kind: "native",
              status: "ready",
            }),
            expect.objectContaining({ id: "codex:acp", kind: "acp", status: "ready" }),
          ])
        } else if (agent.id === "claude") {
          expect(agent.activeDriverId).toBe("claude:sdk")
          expect(agent.drivers).toEqual([
            expect.objectContaining({ id: "claude:cli", kind: "cli", status: "ready" }),
            expect.objectContaining({
              id: "claude:sdk",
              kind: "native",
              status: "ready",
            }),
            expect.objectContaining({ id: "claude:acp", kind: "acp", status: "ready" }),
          ])
        } else if (agent.id === "opencode") {
          expect(agent.activeDriverId).toBe("opencode:acp")
          expect(agent.drivers).toEqual([
            expect.objectContaining({ id: "opencode:cli", kind: "cli", status: "ready" }),
            expect.objectContaining({ id: "opencode:acp", kind: "acp", status: "ready" }),
          ])
        } else if (agent.id === "cursor") {
          expect(agent.activeDriverId).toBe("cursor:acp")
          expect(agent.drivers).toEqual([
            expect.objectContaining({
              id: "cursor:cli",
              kind: "cli",
              degraded: true,
            }),
            expect.objectContaining({ id: "cursor:acp", kind: "acp" }),
          ])
        } else {
          const cliDriverId = `${agent.id}:cli`
          const acpDriverId = `${agent.id}:acp`
          expect(agent.activeDriverId).toBe(cliDriverId)
          expect(agent.drivers).toEqual([
            expect.objectContaining({ id: cliDriverId, kind: "cli", status: "ready" }),
            expect.objectContaining({ id: acpDriverId, kind: "acp", status: "ready" }),
          ])
        }
        expect(agent.models.length).toBeGreaterThan(0)
        expect(agent.models[0]).toEqual(
          expect.objectContaining({ slug: expect.any(String), name: expect.any(String) }),
        )
      }

      const modal = page.locator("[data-gharargah-terminal-modal]")

      for (const provider of ["codex", "claude", "opencode"] as const) {
        await openNewAgentSession(page, provider)
        await expectLocatorVisible(modal)
        await expect.poll(() => modal.getAttribute("data-gharargah-session-mode")).toBe("agent")
        await expectSelectorVisible(page, '[data-gharargah-session-mode-tab="agent"][data-active]')
        await expectLocatorContainsText(modal, provider === "codex" ? "Codex" : provider === "claude" ? "Claude" : "OpenCode")

        const binding = await page.evaluate(async providerId => {
          const raw = localStorage.getItem("gharargah-session-roster-v2")
          if (!raw) return null
          const roster = JSON.parse(raw) as {
            sessions: Array<{ agentId?: string; agentDriverId?: string }>
          }
          return roster.sessions.find(item => item.agentId === providerId) ?? null
        }, provider)
        expect(binding).toBeNull()

        await page.locator("[data-gharargah-terminal-modal-close]").click()
        await expectLocatorCount(modal, 0)
      }

      await openNewAgentSession(page, "cursor")
      await expectLocatorVisible(modal)
      await expect.poll(() => modal.getAttribute("data-gharargah-session-mode")).toBe("agent")
      await expectLocatorCount(modal.locator("[data-gharargah-session-mode-tab]"), 5)
      await expectSelectorVisible(page, '[data-gharargah-session-mode-tab="agent"][data-active]')
      await expectLocatorContainsText(modal, "Cursor")

      const modelPicker = modal.locator('[data-chat-provider-model-picker="true"]')
      await expectLocatorVisible(modelPicker)
      await expectLocatorContainsText(modal, "Auto")

      const composer = modal.locator('[data-testid="composer-editor"]')
      await expectLocatorVisible(composer, { timeout: 20_000 })
      await composer.click()
      await composer.fill("Confirm the session driver")
      await modal.getByRole("button", { name: "Send message" }).click()
      await expectLocatorContainsText(modal, "Confirm the session driver")

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
        const session = roster.sessions.find(item => item.agentId === "cursor") ?? roster.sessions[0]
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

      await expect
        .poll(
          async () => {
            const threadId = persisted!.threadId as string
            const thread = await page.evaluate(async id => {
              const path = window.__gharargahAgent!.getState().activeWorkspace!
              const uri = `file://${path}`
              return window.gharargah!.agents!.readThread(uri, path, id)
            }, threadId)
            const assistant = [...(thread?.messages ?? [])]
              .reverse()
              .find(message => message.role === "assistant")
            return `${thread?.status ?? "missing"}::${assistant?.text ?? ""}`
          },
          { timeout: 30_000 },
        )
        .toContain("Mock agent reply: Confirm the session driver")
      await expectLocatorContainsText(modal, "Confirm the session driver")

      const footer = modal.locator("[data-chat-composer-footer]")
      await expectLocatorCount(footer.locator("[data-agent-interaction-mode]"), 0)
      await expectLocatorCount(footer.locator("[data-agent-runtime-mode]"), 0)
      await modelPicker.click()
      const setupPicker = page.locator("[data-agent-setup-picker]")
      await expectLocatorCount(setupPicker, 1)
      await expectLocatorVisible(setupPicker)
      await expectLocatorVisible(setupPicker.locator("[data-model-picker-content]"))
      await expectLocatorVisible(setupPicker.locator("[data-model-picker-auto]"))
      await expectLocatorVisible(
        setupPicker.locator('[data-model-picker-row][data-model-picker-provider="cursor"]').first(),
      )
      await expectLocatorCount(modal.locator("select[data-agent-runtime-mode]"), 0)
      await expectLocatorCount(modal.locator("select[data-agent-interaction-mode]"), 0)
      await page.keyboard.press("Escape")
      await expect
        .poll(async () => {
          return modal.locator('[data-chat-composer-overlay] [data-slot="permission-card"]').count()
        })
        .toBe(0)
      await expect
        .poll(() =>
          modal.locator('[data-testid="composer-editor"]').getAttribute("aria-placeholder"),
        )
        .toBe("Send follow-up")

      for (const mode of ["terminal", "editor", "git", "todos"] as const) {
        await modal.locator(`[data-gharargah-session-mode-tab="${mode}"]`).click()
        await expectSelectorVisible(
          page,
          `[data-gharargah-session-mode-tab="${mode}"][data-active]`,
        )
        await expectLocatorCount(modal.locator(`[data-gharargah-session-pane="${mode}"][data-active]`), 1)
      }

      await page.locator("[data-gharargah-terminal-modal-close]").click()
      await expectLocatorCount(modal, 0)
      const agentCard = page
        .locator("[data-gharargah-terminal-card]:not([data-gharargah-new-session])")
        .filter({ hasText: "Cursor" })
        .last()
      await expectLocatorVisible(agentCard)
      await agentCard.click()
      await expectLocatorVisible(modal)
      await expect.poll(() => modal.getAttribute("data-gharargah-session-mode")).toBe("agent")
      await expectSelectorVisible(page, '[data-gharargah-session-mode-tab="agent"][data-active]')
    } finally {
      await app.close()
    }
  })
})
