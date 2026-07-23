/**
 * E2E matrix: every gharargah-mock-acp scenario must be covered here.
 * Protocol-level assertions live in apps/server/tests/mock_acp_scenario_matrix.rs;
 * this file verifies the host/UI path still observes each scenario.
 */
import { expect, test } from "@playwright/test"
import { expectLocatorVisible } from "../shell/assert.js"
import { hasPtySpawn, launchJet } from "./_launch.js"
import fs from "node:fs"
import path from "node:path"

const ALL_SCENARIOS = [
  "echo",
  "thought_then_answer",
  "tool_lifecycle",
  "permission_allow",
  "permission_tool_race",
  "plan_update",
  "cancel_coop",
  "slow_stream",
  "usage_meter",
  "config_model",
  "slash_commands",
  "chaos_malformed",
  "load_session",
  "fs_roundtrip",
  "terminal_roundtrip",
  "multi_session",
] as const

async function openCursorAcpSession(page: Awaited<ReturnType<typeof launchJet>>["page"]) {
  await page.evaluate(() => window.gharargah!.agents!.listAgents())
  await page.getByRole("button", { name: "New session" }).first().click()
  await page.getByRole("menuitem", { name: "Cursor (ACP)" }).click()
  const modal = page.locator("[data-gharargah-terminal-modal]")
  await expectLocatorVisible(modal)
  await expect.poll(() => modal.getAttribute("data-gharargah-session-mode")).toBe("agent")
  const composer = modal.locator('[data-testid="composer-editor"]')
  await expectLocatorVisible(composer, { timeout: 20_000 })
  return { modal, composer }
}

async function readActiveThread(page: Awaited<ReturnType<typeof launchJet>>["page"]) {
  const workspace = await page.evaluate(() => window.__gharargahAgent!.getState().activeWorkspace!)
  const uri = `file://${workspace}`
  return page.evaluate(
    async ({ uri, workspace }) => {
      const agents = window.gharargah!.agents!
      const list = await agents.listThreads(uri, workspace)
      const id = list.threads[0]?.id
      if (!id) return null
      return agents.readThread(uri, workspace, id)
    },
    { uri, workspace },
  )
}

async function sendPrompt(
  page: Awaited<ReturnType<typeof launchJet>>["page"],
  modal: ReturnType<Awaited<ReturnType<typeof launchJet>>["page"]["locator"]>,
  composer: ReturnType<Awaited<ReturnType<typeof launchJet>>["page"]["locator"]>,
  text: string,
) {
  await composer.click()
  await composer.fill(text)
  await modal.getByRole("button", { name: "Send message" }).click()
}

async function waitForAssistantContaining(
  page: Awaited<ReturnType<typeof launchJet>>["page"],
  needle: string,
  timeout = 30_000,
) {
  await expect
    .poll(
      async () => {
        const thread = await readActiveThread(page)
        const assistant = [...(thread?.messages ?? [])]
          .reverse()
          .find(message => message.role === "assistant")
        return assistant?.text ?? ""
      },
      { timeout },
    )
    .toContain(needle)
}

test.describe("ACP mock scenario matrix (host path)", () => {
  test.skip(!hasPtySpawn(), "node-pty cannot spawn a shell on this machine")

  test("matrix covers every documented mock scenario name", () => {
    // Keep in sync with apps/server/src/mock_acp/scenarios.rs Scenario::ALL
    expect(ALL_SCENARIOS).toEqual([
      "echo",
      "thought_then_answer",
      "tool_lifecycle",
      "permission_allow",
      "permission_tool_race",
      "plan_update",
      "cancel_coop",
      "slow_stream",
      "usage_meter",
      "config_model",
      "slash_commands",
      "chaos_malformed",
      "load_session",
      "fs_roundtrip",
      "terminal_roundtrip",
      "multi_session",
    ])
  })

  for (const scenario of ALL_SCENARIOS) {
    test(`scenario:${scenario}`, async () => {
      const { app, page } = await launchJet({
        env: {
          GHARARGAH_AGENT_MOCK: "1",
          GHARARGAH_AGENT_MOCK_SCENARIO: scenario,
        },
      })
      try {
        const { modal, composer } = await openCursorAcpSession(page)

        if (scenario === "permission_allow" || scenario === "permission_tool_race") {
          await sendPrompt(page, modal, composer, "need permission")
          await expect
            .poll(async () => (await readActiveThread(page))?.pendingPermissions?.length ?? 0, {
              timeout: 30_000,
            })
            .toBeGreaterThan(0)
          const allow = modal.getByRole("button", { name: "Allow" }).last()
          await expectLocatorVisible(allow, { timeout: 10_000 })
          await allow.click()
          await waitForAssistantContaining(page, "Mock agent reply")
          return
        }

        if (scenario === "cancel_coop") {
          await sendPrompt(page, modal, composer, "please cancel")
          await expect
            .poll(async () => (await readActiveThread(page))?.status ?? "", { timeout: 20_000 })
            .toMatch(/running|waiting_for_permission|cancelling/)
          await modal.getByRole("button", { name: "Stop generation" }).click()
          await expect
            .poll(async () => {
              const thread = await readActiveThread(page)
              return `${thread?.status ?? ""}::${thread?.lastError ?? ""}`
            }, { timeout: 30_000 })
            .toMatch(/cancel|error|interrupted|idle/i)
          return
        }

        if (scenario === "chaos_malformed") {
          await sendPrompt(page, modal, composer, "boom")
          await expect
            .poll(async () => {
              const thread = await readActiveThread(page)
              return `${thread?.status ?? ""}::${thread?.lastError ?? ""}`
            }, { timeout: 30_000 })
            .toMatch(/error|chaos|fail|protocol|malformed/i)
          return
        }

        if (scenario === "fs_roundtrip") {
          const workspace = await page.evaluate(
            () => window.__gharargahAgent!.getState().activeWorkspace!,
          )
          const filePath = path.join(workspace, "acp-fs-fixture.txt")
          fs.writeFileSync(filePath, "fixture-bytes-e2e")
          await sendPrompt(page, modal, composer, filePath)
          await waitForAssistantContaining(page, "Mock read: fixture-bytes-e2e")
          return
        }

        if (scenario === "terminal_roundtrip") {
          await sendPrompt(page, modal, composer, "run terminal")
          await waitForAssistantContaining(page, "Mock terminal:")
          return
        }

        if (scenario === "load_session") {
          // Two-turn load/replay is covered by Rust `matrix_load_session`.
          // E2E asserts the host path advertises/persists an ACP session id.
          await sendPrompt(page, modal, composer, "persist me")
          await waitForAssistantContaining(page, "Mock agent reply: persist me")
          await expect
            .poll(async () => (await readActiveThread(page))?.acpSessionId ?? "", {
              timeout: 15_000,
            })
            .not.toBe("")
          return
        }

        if (scenario === "multi_session") {
          // Distinct ACP session multiplexing is covered by Rust `matrix_multi_session`.
          // E2E asserts the host path can complete a turn under this scenario flag.
          await sendPrompt(page, modal, composer, "alpha")
          await waitForAssistantContaining(page, "Mock agent reply: alpha")
          return
        }

        if (scenario === "thought_then_answer") {
          await sendPrompt(page, modal, composer, "think e2e")
          await expect
            .poll(async () => {
              const thread = await readActiveThread(page)
              const thought = (thread?.timeline ?? []).find(item => item.kind === "thought")
              if (thought && "text" in thought) return thought.text
              return thread?.activity ?? ""
            }, { timeout: 30_000 })
            .toMatch(/Mock thought|Thinking/)
          await waitForAssistantContaining(page, "Mock agent reply: think e2e")
          return
        }

        if (scenario === "tool_lifecycle") {
          await sendPrompt(page, modal, composer, "use tools")
          await expect
            .poll(async () => {
              const thread = await readActiveThread(page)
              return (thread?.timeline ?? []).some(item => item.kind === "tool_call")
            }, { timeout: 30_000 })
            .toBe(true)
          await waitForAssistantContaining(page, "Mock agent reply: use tools")
          return
        }

        if (scenario === "plan_update") {
          await sendPrompt(page, modal, composer, "plan e2e")
          await expect
            .poll(async () => {
              const thread = await readActiveThread(page)
              return Boolean(thread?.plan) || (thread?.timeline ?? []).some(item => item.kind === "plan")
            }, { timeout: 30_000 })
            .toBe(true)
          await waitForAssistantContaining(page, "Mock agent reply: plan e2e")
          return
        }

        if (scenario === "usage_meter") {
          await sendPrompt(page, modal, composer, "usage e2e")
          await expect
            .poll(async () => {
              const thread = await readActiveThread(page)
              return thread?.usage?.used ?? -1
            }, { timeout: 30_000 })
            .toBeGreaterThan(0)
          await waitForAssistantContaining(page, "Mock agent reply: usage e2e")
          return
        }

        if (scenario === "slash_commands") {
          await sendPrompt(page, modal, composer, "slash e2e")
          await expect
            .poll(async () => {
              const thread = await readActiveThread(page)
              return thread?.availableCommands?.length ?? 0
            }, { timeout: 30_000 })
            .toBeGreaterThan(0)
          await waitForAssistantContaining(page, "Mock agent reply: slash e2e")
          return
        }

        // echo | slow_stream | config_model
        await sendPrompt(page, modal, composer, `${scenario} prompt`)
        await waitForAssistantContaining(page, `Mock agent reply: ${scenario} prompt`)
      } finally {
        await app.close()
      }
    })
  }
})
