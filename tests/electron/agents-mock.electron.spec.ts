import { expect, test } from "@playwright/test"
import { describeFlaky } from "./_flaky.js"
import { launchJet } from "./_launch.js"

describeFlaky("electron agents mock", () => {
  test("mock agent turn completes with JET_AGENT_MOCK", async () => {
    const { app, page } = await launchJet({ env: { JET_AGENT_MOCK: "1" } })
    try {
      await page.evaluate(async () => {
        await window.__jetAgent!.executeCommand("agent.new")
      })

      const composer = page.locator('[data-testid="composer-editor"]').first()
      await expect(composer).toBeVisible({ timeout: 20_000 })
      await composer.click()
      await page.keyboard.type("hello mock")
      await page.locator('button[type="submit"]').first().click()

      await expect(page.locator('[data-jet-tab-slot^="jet:agent-chat:"]')).not.toContainText("Running", {
        timeout: 60_000,
      })

      await page.evaluate(async () => {
        await window.__jetAgent!.executeCommand("agents.show")
      })
      await expect(page.locator("[data-jet-list-panel^='jet:agent']").first()).toBeVisible({ timeout: 15_000 })
    } finally {
      await app.close()
    }
  })
})
