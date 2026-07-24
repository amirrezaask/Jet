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
        "grok",
      ])
      for (const agent of catalog.agents) {
        expect(agent.enabled).toBe(true)
        if (agent.id === "cursor-acp") {
          expect(agent.activeDriverId).toBe("cursor:acp")
          expect(agent.drivers).toEqual([
            expect.objectContaining({ id: "cursor:acp", kind: "acp", status: "ready" }),
          ])
        } else if (agent.id === "grok") {
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

      // Codex Agent → shared agent tab + native app-server driver.
      await launcher.click()
      await page.getByRole("menuitem", { name: "Codex Agent" }).click()

      await expectLocatorVisible(modal)
      await expect.poll(() => modal.getAttribute("data-gharargah-session-mode")).toBe("agent")
      await expectSelectorVisible(page, '[data-gharargah-session-mode-tab="agent"][data-active]')
      await expectLocatorContainsText(modal, "Codex")

      const codexBinding = await page.evaluate(async () => {
        const raw = localStorage.getItem("gharargah-session-roster-v2")
        if (!raw) return null
        const roster = JSON.parse(raw) as {
          sessions: Array<{ agentId?: string; agentDriverId?: string }>
        }
        return roster.sessions.find(item => item.agentId === "codex") ?? null
      })
      expect(codexBinding).toEqual(
        expect.objectContaining({ agentId: "codex", agentDriverId: "codex:app-server" }),
      )

      await page.locator("[data-gharargah-terminal-modal-close]").click()
      await expectLocatorCount(modal, 0)

      // Claude Agent → shared agent tab + native Claude SDK driver.
      await launcher.click()
      await page.getByRole("menuitem", { name: "Claude Agent" }).click()

      await expectLocatorVisible(modal)
      await expect.poll(() => modal.getAttribute("data-gharargah-session-mode")).toBe("agent")
      await expectSelectorVisible(page, '[data-gharargah-session-mode-tab="agent"][data-active]')
      await expectLocatorContainsText(modal, "Claude")

      const claudeBinding = await page.evaluate(async () => {
        const raw = localStorage.getItem("gharargah-session-roster-v2")
        if (!raw) return null
        const roster = JSON.parse(raw) as {
          sessions: Array<{ agentId?: string; agentDriverId?: string }>
        }
        return roster.sessions.find(item => item.agentId === "claude") ?? null
      })
      expect(claudeBinding).toEqual(
        expect.objectContaining({ agentId: "claude", agentDriverId: "claude:sdk" }),
      )

      await page.locator("[data-gharargah-terminal-modal-close]").click()
      await expectLocatorCount(modal, 0)

      // OpenCode Agent → shared agent tab + ACP driver.
      await launcher.click()
      await page.getByRole("menuitem", { name: "OpenCode Agent" }).click()

      await expectLocatorVisible(modal)
      await expect.poll(() => modal.getAttribute("data-gharargah-session-mode")).toBe("agent")
      await expectSelectorVisible(page, '[data-gharargah-session-mode-tab="agent"][data-active]')
      await expectLocatorContainsText(modal, "OpenCode")

      const opencodeBinding = await page.evaluate(async () => {
        const raw = localStorage.getItem("gharargah-session-roster-v2")
        if (!raw) return null
        const roster = JSON.parse(raw) as {
          sessions: Array<{ agentId?: string; agentDriverId?: string }>
        }
        return roster.sessions.find(item => item.agentId === "opencode") ?? null
      })
      expect(opencodeBinding).toEqual(
        expect.objectContaining({ agentId: "opencode", agentDriverId: "opencode:acp" }),
      )

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
      // Host-side ACP completion is authoritative; UI virtualization can lag.
      await expectLocatorContainsText(modal, "Confirm the session driver")

      // Interaction mode control present for ACP sessions.
      await expectLocatorVisible(modal.locator("[data-agent-interaction-mode]"))
      await expectLocatorVisible(modal.locator("[data-agent-runtime-mode]"))

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
