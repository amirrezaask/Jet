import { expect, test } from "@playwright/test"
import fs from "node:fs/promises"
import path from "node:path"
import { agent } from "../helpers/agent.js"
import { boot, SAMPLE, waitAnimationsIdle } from "../helpers/boot.js"
import { expectLayout, expectListRows } from "../helpers/list.js"

const AGENT_EXPLORER_PANEL = '[data-jet-list-panel="agent-explorer"]'
const TIMELINE_ROW = '[data-messages-timeline="true"] [data-timeline-row-kind="message"]'

const FIXTURE_AGENT_STATE = {
  threads: [
    {
      id: "agent-sample-1",
      title: "T3 Agent Adapter",
      workspaceRootUri: "file:///Users/amirrezaask/dev/jet/fixtures/sample-workspace",
      workspaceRootPath: "/Users/amirrezaask/dev/jet/fixtures/sample-workspace",
      provider: "cursor",
      model: "auto",
      createdAt: "2026-07-07T10:00:00.000Z",
      updatedAt: "2026-07-07T10:05:00.000Z",
      archivedAt: null,
      status: "idle",
      lastError: null,
      messages: [
        {
          id: "agent-sample-1-user-1",
          role: "user",
          text: "Bring the T3 agent adapter and chat rendering into this workspace.",
          createdAt: "2026-07-07T10:00:00.000Z",
          updatedAt: "2026-07-07T10:00:00.000Z",
          streaming: false,
        },
        {
          id: "agent-sample-1-assistant-1",
          role: "assistant",
          text: 'Implemented the adapter surface and copied the richer message rendering stack.\n\n```ts\nexport const AGENT_EXPLORER_TAB_ID = "jet:agent-explorer"\nexport const AGENT_CHAT_TAB_ID_PREFIX = "jet:agent-chat:"\n```',
          createdAt: "2026-07-07T10:05:00.000Z",
          updatedAt: "2026-07-07T10:05:00.000Z",
          streaming: false,
          changedFiles: [
            { path: "src/utils.ts", additions: 3, deletions: 1 },
            { path: "src/index.ts", additions: 2, deletions: 0 },
          ],
          diffPatch:
            'diff --git a/src/utils.ts b/src/utils.ts\nindex 1111111..2222222 100644\n--- a/src/utils.ts\n+++ b/src/utils.ts\n@@ -1,3 +1,5 @@\n export function greet(name: string) {\n-  return `Hello, ${name}`\n+  const normalized = name.trim()\n+  return normalized.length === 0 ? "Hello" : `Hello, ${normalized}`\n }\n+\ndiff --git a/src/index.ts b/src/index.ts\nindex 3333333..4444444 100644\n--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1,3 +1,5 @@\n import { greet } from "./utils"\n \n console.log(greet("Jet"))\n+console.log(greet("Agents"))\n+console.log(greet("T3"))\n',
        },
      ],
    },
  ],
}

test.beforeEach(async () => {
  const statePath = path.join(process.cwd(), "fixtures/sample-workspace/.jet/agents/state.json")
  await fs.mkdir(path.dirname(statePath), { recursive: true })
  await fs.writeFile(statePath, `${JSON.stringify(FIXTURE_AGENT_STATE, null, 2)}\n`, "utf8")
})

test("agents: explorer and chat render persisted workspace agents", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await waitAnimationsIdle(page)

  await agent(page).executeCommand("agents.show")

  await expect(page.locator(AGENT_EXPLORER_PANEL)).toBeVisible()
  await expectListRows(page, {
    panel: "agent-explorer",
    minItems: 1,
    needle: "T3 Agent Adapter",
    noResultsText: "No agents yet.",
  })

  await page
    .locator(`${AGENT_EXPLORER_PANEL} [data-jet-list-item]`)
    .filter({ hasText: "T3 Agent Adapter" })
    .click()

  const chatTab = page.locator('[data-jet-tab-slot^="jet:agent-chat:"][data-jet-tab-active]')
  await expect(chatTab).toBeVisible()
  await expect(chatTab.locator('[data-chat-header="true"]')).toBeVisible()
  await expect(chatTab.locator('[data-messages-timeline="true"]')).toBeVisible()
  await expectLayout(page, { selector: `${TIMELINE_ROW}`, minItems: 2 })
  await expect(chatTab).toContainText("Implemented the adapter surface")
  await expect(chatTab).toContainText("Changed files (2)")
  await expect(chatTab).toContainText("src/utils.ts")
  await expect(chatTab).toContainText("src/index.ts")
  await expect(chatTab).toContainText("normalized.length === 0")
  await expect(chatTab.locator('[data-chat-composer-form="true"]')).toBeVisible()
  await expect(chatTab.locator('[data-chat-provider-model-picker="true"]')).toBeVisible()
})

test("agents: timeline renders changed-files tree and diff patch", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await waitAnimationsIdle(page)

  await agent(page).executeCommand("agents.show")
  await page
    .locator(`${AGENT_EXPLORER_PANEL} [data-jet-list-item]`)
    .filter({ hasText: "T3 Agent Adapter" })
    .click()

  const chatTab = page.locator('[data-jet-tab-slot^="jet:agent-chat:"][data-jet-tab-active]')
  const assistantRow = chatTab.locator('[data-message-id="agent-sample-1-assistant-1"]')
  await expect(assistantRow).toBeVisible()
  await expect(assistantRow).toContainText("Implemented the adapter surface")
  await expect(assistantRow).toContainText("Changed files (2)")
  await expect(assistantRow.locator("text=src/utils.ts")).toBeVisible()
  await expect(assistantRow.locator("text=src/index.ts")).toBeVisible()
  await expect(assistantRow).toContainText("normalized.length === 0")
  await expect(assistantRow).toContainText("src/index.ts")
})

test("agents: model picker lists dynamic provider models", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await waitAnimationsIdle(page)

  await agent(page).executeCommand("agents.show")
  await page
    .locator(`${AGENT_EXPLORER_PANEL} [data-jet-list-item]`)
    .filter({ hasText: "T3 Agent Adapter" })
    .click()

  const chatTab = page.locator('[data-jet-tab-slot^="jet:agent-chat:"][data-jet-tab-active]')
  await chatTab.locator('[data-chat-provider-model-picker="true"]').click()
  await expect(page.locator('[data-model-picker-content]')).toBeVisible()
  const modelRows = page.locator('[data-model-picker-content] [data-slot="combobox-item"]')
  await expect(modelRows).toHaveCount(1, { timeout: 5000 })
  await expect(modelRows.filter({ hasText: "Auto" })).toBeVisible()
})

test("agents: send message produces mock assistant reply", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await waitAnimationsIdle(page)

  await agent(page).executeCommand("agents.show")
  await page
    .locator(`${AGENT_EXPLORER_PANEL} [data-jet-list-item]`)
    .filter({ hasText: "T3 Agent Adapter" })
    .click()

  const chatTab = page.locator('[data-jet-tab-slot^="jet:agent-chat:"][data-jet-tab-active]')
  await chatTab.locator('[data-testid="composer-editor"]').click()
  await page.keyboard.type("Runtime test prompt")
  await chatTab.locator('button[type="submit"]').click()
  await expect(chatTab).toContainText("Mock agent reply: Runtime test prompt", { timeout: 15_000 })
})

test("agents: send message without infinite update loop", async ({ page }) => {
  const consoleErrors: string[] = []
  page.on("console", msg => {
    if (msg.type() === "error") consoleErrors.push(msg.text())
  })

  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await waitAnimationsIdle(page)

  await agent(page).executeCommand("agents.show")
  await page
    .locator(`${AGENT_EXPLORER_PANEL} [data-jet-list-item]`)
    .filter({ hasText: "T3 Agent Adapter" })
    .click()

  const chatTab = page.locator('[data-jet-tab-slot^="jet:agent-chat:"][data-jet-tab-active]')
  await chatTab.locator('[data-testid="composer-editor"]').click()
  await page.keyboard.type("Hello from Playwright agent test")
  await chatTab.locator('button[type="submit"]').click()

  await expect(chatTab).toContainText("Hello from Playwright agent test")
  expect(consoleErrors.some(text => text.includes("Maximum update depth exceeded"))).toBe(false)
})

test("agents: agent.new creates thread and opens chat", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await waitAnimationsIdle(page)

  await agent(page).executeCommand("agent.new")

  await expect(page.locator(AGENT_EXPLORER_PANEL)).toBeVisible()
  await expectListRows(page, {
    panel: "agent-explorer",
    minItems: 2,
    needle: "T3 Agent Adapter",
    noResultsText: "No agents yet.",
  })

  const chatTab = page.locator('[data-jet-tab-slot^="jet:agent-chat:"][data-jet-tab-active]')
  await expect(chatTab).toBeVisible()
  await expect(chatTab.locator('[data-chat-composer-form="true"]')).toBeVisible()
})

test("agents: interrupt mid-mock-turn stops generation", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await waitAnimationsIdle(page)

  await agent(page).executeCommand("agents.show")
  await page
    .locator(`${AGENT_EXPLORER_PANEL} [data-jet-list-item]`)
    .filter({ hasText: "T3 Agent Adapter" })
    .click()

  const chatTab = page.locator('[data-jet-tab-slot^="jet:agent-chat:"][data-jet-tab-active]')
  await chatTab.locator('[data-testid="composer-editor"]').click()
  await page.keyboard.type("Interrupt me with a very long prompt that should stream for a while")
  await chatTab.locator('button[type="submit"]').click()

  await expect(chatTab.getByText("Agent is running…")).toBeVisible({ timeout: 5_000 })
  await chatTab.getByRole("button", { name: "Stop generation" }).click()

  await expect(chatTab.getByText("Agent is running…")).toBeHidden({ timeout: 10_000 })
  await expect(chatTab).not.toContainText(
    "Mock agent reply: Interrupt me with a very long prompt that should stream for a while",
    { timeout: 3_000 },
  )
})

test("agents: archive removes thread from active explorer list", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await waitAnimationsIdle(page)

  await agent(page).executeCommand("agents.show")
  await page
    .locator(`${AGENT_EXPLORER_PANEL} [data-jet-list-item]`)
    .filter({ hasText: "T3 Agent Adapter" })
    .click()

  const chatTab = page.locator('[data-jet-tab-slot^="jet:agent-chat:"][data-jet-tab-active]')
  await expect(chatTab).toBeVisible()

  await agent(page).executeCommand("agent.archive")

  await expect(
    page.locator(`${AGENT_EXPLORER_PANEL} [data-jet-list-item]`).filter({ hasText: "T3 Agent Adapter" }),
  ).toHaveCount(0)
  await expect(page.getByText("Archived (1)")).toBeVisible()
  await expect(chatTab).toBeHidden({ timeout: 5_000 })
})
