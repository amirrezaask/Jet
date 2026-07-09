import { expect, test } from "@playwright/test"
import { describeFlaky } from "./_flaky.js"
import { hasCursorAgent, launchJet } from "./_launch.js"

const cursorAgentAvailable = hasCursorAgent()

describeFlaky("electron agents", () => {
  test.skip(!cursorAgentAvailable, "cursor-agent not on PATH")

  test("real cursor-agent turn completes in agent chat", async () => {
    const { app, page } = await launchJet()
    try {
      await page.evaluate(async () => {
        await window.__jetAgent!.executeCommand("agent.new")
      })

      const chatTab = page.locator('[data-jet-tab-slot^="jet:agent-chat:"][data-jet-tab-active]')
      await expect(chatTab).toBeVisible({ timeout: 15_000 })
      await chatTab.locator('[data-testid="composer-editor"]').click()
      await page.keyboard.type("Reply with exactly: OK")
      await chatTab.locator('button[type="submit"]').click()

      await expect(chatTab).toContainText("OK", { timeout: 120_000 })

      const threadStatus = await page.evaluate(async () => {
        const folder = window.__jetAgent!.getState().workspacePath
        if (!folder || !window.jet?.agents?.readThread) return null
        const snapshot = await window.jet.agents.listThreads(`file://${folder}`, folder)
        const threadId = snapshot.threads[0]?.id
        if (!threadId) return null
        const thread = await window.jet.agents.readThread(`file://${folder}`, folder, threadId)
        return thread?.status ?? null
      })
      expect(threadStatus).toBe("idle")
    } finally {
      await app.close()
    }
  })
})
