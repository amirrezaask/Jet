import { expect, test } from "@playwright/test"
import type { AgentThread } from "@gharargah/agents"
import {
  expectLocatorContainsText,
  expectLocatorCount,
  expectLocatorVisible,
} from "../shell/assert.js"
import type { ShellDriver } from "../shell/driver.js"
import { hasPtySpawn, launchJet, openNewAgentSession } from "./_launch.js"

const providers = [
  {
    id: "codex",
    label: "Codex",
    driverId: "codex:app-server",
    listedModel: "Mock Codex",
    firstReply: "mock:hello codex",
    secondReply: "process-turn:2",
  },
  {
    id: "claude",
    label: "Claude",
    driverId: "claude:sdk",
    listedModel: "Sonnet",
    firstReply: "mock:hello claude",
    secondReply: "process-turn:2",
  },
  {
    id: "opencode",
    label: "OpenCode",
    driverId: "opencode:acp",
    listedModel: "OpenCode",
    firstReply: "Mock agent reply: hello opencode",
    secondReply: "Mock agent reply: process-count",
  },
  {
    id: "cursor",
    label: "Cursor",
    driverId: "cursor:acp",
    listedModel: "Composer",
    firstReply: "Mock agent reply: hello cursor",
    secondReply: "Mock agent reply: process-count",
  },
] as const

async function readProviderThread(
  page: ShellDriver,
  providerId: string,
): Promise<AgentThread | null> {
  return page.evaluate(async id => {
    const raw = localStorage.getItem("gharargah-session-roster-v2")
    if (!raw) return null
    const roster = JSON.parse(raw) as {
      sessions: Array<{ agentId?: string; agentThreadId?: string }>
    }
    const session = [...roster.sessions].reverse().find(item => item.agentId === id)
    const threadId = session?.agentThreadId
    const workspacePath = window.__gharargahAgent?.getState().activeWorkspace
    if (!threadId || !workspacePath) return null
    return window.gharargah?.agents?.readThread(
      `file://${workspacePath}`,
      workspacePath,
      threadId,
    ) ?? null
  }, providerId)
}

async function listThreadIds(page: ShellDriver): Promise<string[]> {
  return page.evaluate(async () => {
    const workspacePath = window.__gharargahAgent?.getState().activeWorkspace
    if (!workspacePath) return []
    const snapshot = await window.gharargah?.agents?.listThreads(
      `file://${workspacePath}`,
      workspacePath,
    )
    return snapshot?.threads.map(thread => thread.id) ?? []
  })
}

async function sendMessage(
  page: ShellDriver,
  modal: ReturnType<ShellDriver["locator"]>,
  providerId: string,
  text: string,
): Promise<void> {
  const composer = modal.locator('[data-testid="composer-editor"]')
  await expectLocatorVisible(composer)
  const before =
    (await readProviderThread(page, providerId))?.messages.filter(
      message => message.role === "user",
    ).length ?? 0
  await composer.fill(text)
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    await composer.press("Enter")
    await page.waitForTimeout(100)
    const count =
      (await readProviderThread(page, providerId))?.messages.filter(
        message => message.role === "user",
      ).length ?? 0
    if (count > before) return
  }
  const thread = await readProviderThread(page, providerId)
  throw new Error(
    `composer did not submit for ${providerId}: ${thread?.status ?? "missing"} ${thread?.lastError ?? ""}`,
  )
}

async function waitForAssistant(
  page: ShellDriver,
  providerId: string,
  expected: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const thread = await readProviderThread(page, providerId)
        const assistant = [...(thread?.messages ?? [])]
          .reverse()
          .find(message => message.role === "assistant")
        return `${thread?.status ?? "missing"}::${assistant?.text ?? ""}::${thread?.lastError ?? ""}`
      },
      { timeout: 30_000 },
    )
    .toContain(`idle::${expected}`)
}

test.describe("unified agent provider UI", () => {
  test.skip(!hasPtySpawn(), "the session modal requires a PTY-capable host")

  for (const provider of providers) {
    test(`${provider.label} uses the same durable multi-turn agent surface`, async () => {
      const { app, page } = await launchJet({
        env: {
          GHARARGAH_AGENT_MOCK: "1",
          GHARARGAH_AGENT_MOCK_SCENARIO: "echo",
        },
      })
      try {
        const threadsBefore = new Set(await listThreadIds(page))
        const modal = await openNewAgentSession(page, provider.id)
        await expect.poll(() => modal.getAttribute("data-gharargah-session-mode")).toBe("agent")
        await expectLocatorVisible(modal.locator("[data-chat-slim-title]"))
        await expectLocatorVisible(modal.locator("[data-messages-timeline]"))
        await expectLocatorVisible(modal.locator("[data-chat-composer-form]"))
        await expectLocatorVisible(modal.locator("[data-chat-provider-model-picker]"))
        await expectLocatorVisible(modal.locator('[data-composer-attach-file="true"]'))
        await expectLocatorVisible(modal.locator("[data-composer-mic-stub]"))
        await expect
          .poll(() =>
            modal.locator('[data-testid="composer-editor"]').getAttribute("aria-placeholder"),
          )
          .toBe("Send follow-up")
        const modelPicker = modal.locator("[data-chat-provider-model-picker]")
        await expectLocatorContainsText(modelPicker, provider.label)
        await expectLocatorCount(modal.getByRole("button", { name: "Inspect ACP session" }), 0)
        await expect
          .poll(() => modal.locator("[data-chat-provider]").getAttribute("data-chat-provider"))
          .toBe(provider.id)
        await expect
          .poll(() => modal.locator("[data-chat-driver]").getAttribute("data-chat-driver"))
          .toBe("unknown")
        const createdThreads = (await listThreadIds(page)).filter(id => !threadsBefore.has(id))
        expect(createdThreads).toHaveLength(0)
        const unboundRoster = await page.evaluate(() => {
          const raw = localStorage.getItem("gharargah-session-roster-v2")
          if (!raw) return null
          const roster = JSON.parse(raw) as {
            sessions: Array<{
              agentId?: string
              agentDriverId?: string
              agentThreadId?: string
            }>
          }
          return roster.sessions.at(-1) ?? null
        })
        expect(unboundRoster).not.toEqual(
          expect.objectContaining({
            agentDriverId: expect.any(String),
            agentThreadId: expect.any(String),
          }),
        )

        await modelPicker.click()
        const setupPicker = page.locator("[data-agent-setup-picker]")
        await expectLocatorCount(setupPicker, 1)
        await expectLocatorVisible(
          setupPicker.locator(`[data-model-picker-row][data-model-picker-provider="${provider.id}"]`).first(),
        )
        await expectLocatorContainsText(setupPicker, `${provider.label}:`)
        await expectLocatorVisible(setupPicker.locator("[data-model-picker-auto]"))
        await expectLocatorVisible(setupPicker.locator("[data-model-picker-add-models]"))
        if (provider.id === "codex" || provider.id === "claude") {
          await setupPicker
            .locator(`[data-model-picker-row][data-model-picker-provider="${provider.id}"]`)
            .filter({ hasText: provider.listedModel })
            .first()
            .click()
          await expect
            .poll(() => page.locator("[data-agent-setup-picker]").count())
            .toBe(0)
          expect(await readProviderThread(page, provider.id)).toBeNull()
        } else {
          await page.keyboard.press("Escape")
          await expect
            .poll(() => page.locator("[data-agent-setup-picker]").count())
            .toBe(0)
        }

        await sendMessage(page, modal, provider.id, `hello ${provider.id}`)
        await waitForAssistant(page, provider.id, provider.firstReply)
        await expectLocatorVisible(modal.locator("[data-chat-user-bubble]").first())
        await expectLocatorVisible(modal.locator("[data-chat-terminal-pill]"))
        await expect
          .poll(
            async () =>
              (await modal.locator("[data-chat-turn-status]").first().textContent()) ?? "",
            { timeout: 15_000 },
          )
          .toContain("Completed")
        const createdAfterFirstMessage = (await listThreadIds(page)).filter(
          id => !threadsBefore.has(id),
        )
        expect(createdAfterFirstMessage).toHaveLength(1)

        await sendMessage(page, modal, provider.id, "process-count")
        await waitForAssistant(page, provider.id, provider.secondReply)

        const thread = await readProviderThread(page, provider.id)
        expect(thread).toEqual(
          expect.objectContaining({
            agentId: provider.id,
            driverId: provider.driverId,
            status: "idle",
          }),
        )
        expect(thread?.messages.filter(message => message.role === "user")).toHaveLength(2)
        if (provider.driverId.endsWith(":acp")) {
          expect(thread?.acpSessionId).toEqual(expect.any(String))
        } else {
          expect(thread?.providerSessionId).toEqual(expect.any(String))
        }

        await page.locator("[data-gharargah-terminal-modal-close]").click()
        await expectLocatorCount(modal, 0)
        const card = page
          .locator("[data-gharargah-session-card]")
          .filter({ hasText: provider.label })
          .first()
        await expectLocatorVisible(card)
        await card.click()
        await expectLocatorVisible(modal)
        await expect.poll(() => modal.getAttribute("data-gharargah-session-mode")).toBe("agent")
        await expectLocatorContainsText(modal, provider.secondReply)
      } finally {
        await app.close()
      }
    })
  }

  for (const provider of providers.slice(0, 2)) {
    test(`${provider.label} permission, cancellation, draft, and recovery lifecycle`, async () => {
      const { app, page } = await launchJet({ env: { GHARARGAH_AGENT_MOCK: "1" } })
      try {
        const modal = await openNewAgentSession(page, provider.id)

        await sendMessage(
          page,
          modal,
          provider.id,
          provider.id === "codex" ? "request permission" : "permission",
        )
        const permission = modal.locator('[data-slot="permission-card"]').first()
        await expectLocatorVisible(permission, { timeout: 20_000 })
        await permission.getByRole("button", { name: /^Allow once$/ }).click()
        await waitForAssistant(page, provider.id, "permission")

        await sendMessage(page, modal, provider.id, "wait")
        const stop = modal.getByRole("button", { name: "Stop generation" })
        await expectLocatorVisible(stop)
        const composer = modal.locator('[data-testid="composer-editor"]')
        await composer.fill("recovered after stop")
        await stop.click()
        await expect
          .poll(async () => (await readProviderThread(page, provider.id))?.status, {
            timeout: 20_000,
          })
          .toBe("cancelled")
        await expect.poll(() => composer.textContent()).toContain("recovered after stop")
        await sendMessage(page, modal, provider.id, "recovered after stop")
        await waitForAssistant(page, provider.id, "mock:recovered after stop")
      } finally {
        await app.close()
      }
    })
  }
})
