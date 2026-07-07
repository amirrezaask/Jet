import { expect, test } from "@playwright/test"
import { agent } from "../helpers/agent.js"
import { boot, SAMPLE, waitAnimationsIdle } from "../helpers/boot.js"
import { expectListRows } from "../helpers/list.js"

const AGENT_EXPLORER_PANEL = '[data-jet-list-panel="agent-explorer"]'

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
  await expect(chatTab).toContainText("Implemented the adapter surface")
  await expect(chatTab).toContainText("2 changed files")
  await expect(chatTab).toContainText("src/utils.ts")
  await expect(chatTab).toContainText("src/index.ts")
  await expect(chatTab).toContainText("normalized.length === 0")
  await expect(chatTab.locator('[data-chat-composer-form="true"]')).toBeVisible()
  await expect(chatTab.locator('[data-chat-provider-model-picker="true"]')).toBeVisible()
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
  await expect(modelRows).toHaveCount(2, { timeout: 5000 })
  await expect(modelRows.filter({ hasText: "5 Mini" })).toBeVisible()
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
