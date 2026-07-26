import { expect, test } from "@playwright/test"
import {
  expectLocatorContainsText,
  expectLocatorCount,
  expectLocatorVisible,
  expectSelectorVisible,
} from "../shell/assert.js"
import { hasPtySpawn, launchJet } from "./_launch.js"

const ptyAvailable = hasPtySpawn()
/** Agent chat is enabled by default; 0 builds the recovery-only terminal surface. */
const agentChatE2e = process.env.GHARARGAH_ENABLE_AGENT_CHAT !== "0"

test.describe("project session CLIs", () => {
  test.skip(!ptyAvailable, "node-pty cannot spawn a shell on this machine")

  test("CLI Cursor stays in terminal without Agent tab", async () => {
    const { app, page } = await launchJet({ env: { GHARARGAH_AGENT_MOCK: "1" } })
    try {
      const launcher = page.getByRole("button", { name: "New session" }).first()
      await launcher.click()
      await page.locator('[data-gharargah-cli-shortcut="cursor"]').click()

      const modal = page.locator("[data-gharargah-terminal-modal]")
      await expectLocatorVisible(modal)
      await expect.poll(() => modal.getAttribute("data-gharargah-session-mode")).toBe("terminal")
      await expectLocatorCount(modal.locator("[data-gharargah-session-mode-tab]"), 4)
      await expectLocatorCount(modal.locator('[data-gharargah-session-mode-tab="agent"]'), 0)

      for (const mode of ["terminal", "editor", "git", "todos"] as const) {
        await modal.locator(`[data-gharargah-session-mode-tab="${mode}"]`).click()
        await expectSelectorVisible(
          page,
          `[data-gharargah-session-mode-tab="${mode}"][data-active]`,
        )
      }
    } finally {
      await app.close()
    }
  })
  test("CLI Codex / Claude / OpenCode stay in their provider-neutral terminal flow", async () => {
    const { app, page } = await launchJet()
    try {
      const launcher = page.getByRole("button", { name: "New session" }).first()
      for (const { id, command } of [
        { id: "codex", command: "codex" },
        { id: "claude", command: "claude" },
        { id: "opencode", command: "opencode" },
      ] as const) {
        await launcher.click()
        await page.locator(`[data-gharargah-cli-shortcut="${id}"]`).click()
        const modal = page.locator("[data-gharargah-terminal-modal]")
        await expectLocatorVisible(modal)
        await expect.poll(() => modal.getAttribute("data-gharargah-session-mode")).toBe("terminal")
        await expectLocatorCount(modal.locator('[data-gharargah-session-mode-tab="agent"]'), 0)
        await expect
          .poll(() => page.locator("[data-gharargah-terminal-launch-command]").textContent())
          .toBe(command)
        await page.locator("[data-gharargah-terminal-modal-close]").click()
        await expectLocatorCount(modal, 0)
      }
    } finally {
      await app.close()
    }
  })
})

test.describe("project session agent chat", () => {
  test.skip(!ptyAvailable, "node-pty cannot spawn a shell on this machine")
  test.skip(
    !agentChatE2e,
    "disabled in GHARARGAH_ENABLE_AGENT_CHAT=0 recovery builds",
  )

  test("Cursor opens the unified agent tab; CLI agents stay in terminal", async () => {
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

      // CLI Cursor → terminal only, launches cursor-agent, no Agent tab.
      const launcher = page.getByRole("button", { name: "New session" }).first()
      await launcher.click()
      await page.locator('[data-gharargah-cli-shortcut="cursor"]').click()

      const modal = page.locator("[data-gharargah-terminal-modal]")
      await expectLocatorVisible(modal)
      await expect.poll(() => modal.getAttribute("data-gharargah-session-mode")).toBe("terminal")
      await expectLocatorCount(modal.locator("[data-gharargah-session-mode-tab]"), 4)
      await expectLocatorCount(modal.locator('[data-gharargah-session-mode-tab="agent"]'), 0)
      await page.locator("[data-gharargah-terminal-modal-close]").click()
      await expectLocatorCount(modal, 0)

      // Codex Agent → shared agent tab + native app-server driver.
      await launcher.click()
      await page.locator('[data-gharargah-agent-shortcut="codex"]').click()

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
      await page.locator('[data-gharargah-agent-shortcut="claude"]').click()

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
      await page.locator('[data-gharargah-agent-shortcut="opencode"]').click()

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

      // Cursor → agent tab + ACP driver.
      await launcher.click()
      await page.locator('[data-gharargah-agent-shortcut="cursor"]').click()

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
      // Host-side ACP completion is authoritative; UI virtualization can lag.
      await expectLocatorContainsText(modal, "Confirm the session driver")

      // Provider, model, mode, reasoning, speed, and access share one composer surface.
      const footer = modal.locator("[data-chat-composer-footer]")
      await expectLocatorCount(footer.locator("[data-agent-interaction-mode]"), 0)
      await expectLocatorCount(footer.locator("[data-agent-runtime-mode]"), 0)
      await modelPicker.click()
      const setupPicker = page.locator("[data-agent-setup-picker]")
      await expectLocatorCount(setupPicker, 1)
      await expectLocatorVisible(setupPicker)
      await expectLocatorContainsText(setupPicker, "Cursor settings")
      await expectLocatorVisible(setupPicker.locator('[data-agent-setting-group="access"]'))
      // The generic echo ACP scenario does not advertise provider modes.
      // Unsupported provider controls must stay hidden.
      await expectLocatorCount(setupPicker.locator('[data-agent-setting-group="mode"]'), 0)
      await expectLocatorCount(modal.locator("select[data-agent-runtime-mode]"), 0)
      await expectLocatorCount(modal.locator("select[data-agent-interaction-mode]"), 0)
      await page.keyboard.press("Escape")
      await expect
        .poll(async () => {
          return modal.locator('[data-chat-composer-overlay] [data-slot="permission-card"]').count()
        })
        .toBe(0)
      await expectLocatorContainsText(
        modal.locator("[data-chat-composer-overlay]"),
        "Message agent",
      )

      for (const mode of ["terminal", "editor", "git", "todos"] as const) {
        await modal.locator(`[data-gharargah-session-mode-tab="${mode}"]`).click()
        await expectSelectorVisible(
          page,
          `[data-gharargah-session-mode-tab="${mode}"][data-active]`,
        )
        await expectLocatorCount(modal.locator(`[data-gharargah-session-pane="${mode}"][data-active]`), 1)
      }

      // Reopen agent card from home → agent tab (not terminal).
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
