import { test, expect } from "@playwright/test"
import { boot, SAMPLE, waitAnimationsIdle } from "../helpers/boot.js"
import { agent } from "../helpers/agent.js"

test.beforeEach(async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await waitAnimationsIdle(page)
})

test("agent: new codex session opens tab with stub transcript", async ({ page }) => {
  await agent(page).executeCommand("agent.newSession.codex")
  await page.waitForTimeout(400)

  const panel = page.locator('[data-jet-agent-panel][data-jet-agent-provider="codex"]')
  await expect(panel).toBeVisible()
  await expect(panel).toHaveAttribute("data-jet-agent-status", /connecting|ready|streaming/)
  await expect(panel).toContainText("Codex")
  await expect(panel).toContainText("sample-workspace")

  const composer = page.locator('[data-jet-agent-composer]')
  await expect(composer).toBeDisabled()

  const state = await agent(page).getState()
  expect(state.agentSessions.length).toBeGreaterThanOrEqual(1)
  expect(state.agentSessions.some(s => s.provider === "codex")).toBe(true)
})

test("agent: multiple providers create separate tabs", async ({ page }) => {
  await agent(page).executeCommand("agent.newSession.codex")
  await page.waitForTimeout(300)
  await agent(page).executeCommand("agent.newSession.claude")
  await page.waitForTimeout(300)

  await expect(page.locator('[data-jet-agent-provider="codex"]')).toHaveCount(1)
  await expect(page.locator('[data-jet-agent-provider="claude"]')).toHaveCount(1)

  const state = await agent(page).getState()
  expect(state.agentSessions.filter(s => s.provider === "codex").length).toBe(1)
  expect(state.agentSessions.filter(s => s.provider === "claude").length).toBe(1)
})
