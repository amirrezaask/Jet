import { expect, test } from "@playwright/test"
import {
  expectLocatorContainsText,
  expectLocatorCount,
  expectLocatorVisible,
  expectSelectorVisible,
} from "../shell/assert.js"
import { hasPtySpawn, launchJet, openNewNativeAgentSession } from "./_launch.js"

const ptyAvailable = hasPtySpawn()
/** Agent chat is enabled by default; 0 builds the recovery-only terminal surface. */
const agentChatE2e = process.env.GHARARGAH_ENABLE_AGENT_CHAT !== "0"

const nativeDriverIds: Record<string, string> = {
  codex: "codex:app-server",
  claude: "claude:sdk",
  opencode: "opencode:sdk",
  cursor: "cursor:acp",
}

test.describe("project session agent chat", () => {
  test.skip(!ptyAvailable, "node-pty cannot spawn a shell on this machine")
  test.skip(
    !agentChatE2e,
    "disabled in GHARARGAH_ENABLE_AGENT_CHAT=0 recovery builds",
  )

  test("New session opens agent chat; providers bind via model picker", async () => {
    const { app, page } = await launchJet({ env: { GHARARGAH_AGENT_MOCK: "1" } })
    try {
      const effectHealth = await page.evaluate(async () => {
        const url =
          (window as Window & { __GHARARGAH_AGENT_WS_URL__?: string }).__GHARARGAH_AGENT_WS_URL__ ??
          null
        if (!url) return { ok: false, url: null as string | null }
        return await new Promise<{ ok: boolean; url: string | null }>(resolve => {
          const ws = new WebSocket(url)
          const t = setTimeout(() => {
            ws.close()
            resolve({ ok: false, url })
          }, 5_000)
          ws.addEventListener("open", () => {
            ws.send(JSON.stringify({ id: 99, method: "health", params: [] }))
          })
          ws.addEventListener("message", ev => {
            try {
              const msg = JSON.parse(String(ev.data)) as { id?: number; result?: { ok?: boolean } }
              if (msg.id === 99) {
                clearTimeout(t)
                ws.close()
                resolve({ ok: Boolean(msg.result?.ok), url })
              }
            } catch {
              /* ignore */
            }
          })
        })
      })
      expect(effectHealth.ok).toBe(true)
      expect(effectHealth.url).toMatch(/^ws:\/\//)

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
              kind: "app-server",
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
              kind: "sdk",
              status: "ready",
            }),
            expect.objectContaining({ id: "claude:acp", kind: "acp", status: "ready" }),
          ])
        } else if (agent.id === "opencode") {
          expect(agent.activeDriverId).toBe("opencode:sdk")
          expect(agent.drivers).toEqual([
            expect.objectContaining({ id: "opencode:cli", kind: "cli", status: "ready" }),
            expect.objectContaining({ id: "opencode:sdk", kind: "sdk", status: "ready" }),
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
        await openNewNativeAgentSession(page, provider)
        await expectLocatorVisible(modal)
        await expect.poll(() => modal.getAttribute("data-gharargah-session-mode")).toBe("agent")
        await expectSelectorVisible(page, '[data-gharargah-session-mode-tab="agent"][data-active]')
        await expectLocatorContainsText(modal, provider === "codex" ? "Codex" : provider === "claude" ? "Claude" : "OpenCode")

        // A native session knows its agent and driver up front so the first
        // turn routes correctly, but no thread exists until the user sends.
        const binding = await page.evaluate(async providerId => {
          const res = await fetch("/api/v1/sessions")
          if (!res.ok) return null
          const roster = (await res.json()) as {
            sessions: Array<{
              agentId?: string
              agentDriverId?: string
              agentThreadId?: string
              launchCommand?: string
            }>
          }
          return roster.sessions.find(item => item.agentId === providerId) ?? null
        }, provider)
        expect(binding).toMatchObject({
          agentId: provider,
          agentDriverId: nativeDriverIds[provider],
        })
        expect(binding?.agentThreadId).toBeUndefined()
        expect(binding?.launchCommand).toBeUndefined()

        await page.locator("[data-gharargah-terminal-modal-close]").click()
        await expectLocatorCount(modal, 0)
      }

      await openNewNativeAgentSession(page, "cursor")
      await expectLocatorVisible(modal)
      await expect.poll(() => modal.getAttribute("data-gharargah-session-mode")).toBe("agent")
      await expectLocatorCount(modal.locator("[data-gharargah-session-mode-tab]"), 4)
      await expectSelectorVisible(page, '[data-gharargah-session-mode-tab="agent"][data-active]')
      await expectLocatorContainsText(modal, "Cursor")

      const modelPicker = modal.locator('[data-chat-provider-model-picker="true"]')
      await expectLocatorVisible(modelPicker)
      await expectLocatorContainsText(modal, "Auto")

      const composer = modal.locator('[data-testid="composer-editor"]')
      await expectLocatorVisible(composer, { timeout: 20_000 })

      await expect
        .poll(() =>
          page.evaluate(() => {
            const surface = document.querySelector<HTMLElement>(".chat-composer-glass")
            if (!surface) return ""
            return getComputedStyle(surface).backgroundColor
          }),
        )
        .not.toBe("rgb(0, 0, 0)")

      await page.evaluate(async () => {
        await window.__gharargahAgent!.executeCommand("ui.setTheme.default-light")
      })
      await expect
        .poll(() =>
          page.evaluate(() => document.documentElement.classList.contains("dark")),
        )
        .toBe(false)
      await expect
        .poll(() =>
          page.evaluate(() => {
            const surface = document.querySelector<HTMLElement>(".chat-composer-glass")
            if (!surface) return null
            const bg = getComputedStyle(surface).backgroundColor
            return {
              bg,
              inline: document.documentElement.style.getPropertyValue("--agent-composer-surface"),
            }
          }),
        )
        .toMatchObject({
          inline: expect.stringMatching(/#ffffff|#fafafa|oklch/i),
        })

      await composer.click()
      await composer.fill("Confirm the session driver")
      await expect
        .poll(
          async () =>
            modal.locator('[data-composer-send="true"]').evaluate(
              el => !(el as HTMLButtonElement).disabled,
            ),
          { timeout: 10_000 },
        )
        .toBe(true)
      await modal.locator('[data-composer-send="true"]').click()
      await expect
        .poll(
          async () => {
            return page.evaluate(async () => {
              const res = await fetch("/api/v1/sessions")
              if (!res.ok) return null
              const roster = (await res.json()) as {
                sessions: Array<{
                  agentId?: string
                  agentDriverId?: string
                  agentThreadId?: string
                }>
              }
              const session =
                roster.sessions.find(item => item.agentId === "cursor") ?? roster.sessions[0]
              return session?.agentThreadId ?? null
            })
          },
          { timeout: 20_000 },
        )
        .toEqual(expect.any(String))
      await expectLocatorContainsText(modal, "Confirm the session driver")

      const persisted = await page.evaluate(async () => {
        const res = await fetch("/api/v1/sessions")
        if (!res.ok) return null
        const roster = (await res.json()) as {
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
          return modal
            .locator('[data-chat-composer-overlay] [data-slot="composer-pending-approval"]')
            .count()
        })
        .toBe(0)
      await expect
        .poll(() =>
          modal.locator('[data-testid="composer-editor"]').getAttribute("aria-placeholder"),
        )
        .toBe("Send follow-up")

      for (const mode of ["terminal", "editor", "git"] as const) {
        await modal.locator(`[data-gharargah-session-mode-tab="${mode}"]`).click()
        await expectSelectorVisible(
          page,
          `[data-gharargah-session-mode-tab="${mode}"][data-active]`,
        )
        await expectLocatorCount(modal.locator(`[data-gharargah-session-pane="${mode}"][data-active]`), 1)
      }
      await page.evaluate(() =>
        window.__gharargahAgent!.executeCommand("dialog.showTodos"),
      )
      await expectLocatorCount(
        modal.locator('[data-gharargah-session-pane="todos"][data-active]'),
        1,
      )

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
