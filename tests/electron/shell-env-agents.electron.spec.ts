import { expect, test } from "@playwright/test"
import { expectLocatorVisible } from "../shell/assert.js"
import { hasPtySpawn, launchJet, openNewNativeAgentSession } from "./_launch.js"

const ptyAvailable = hasPtySpawn()
const agentChatE2e = process.env.GHARARGAH_ENABLE_AGENT_CHAT !== "0"

/**
 * A desktop launch from Finder/Dock hands the host a GUI-stripped PATH with no
 * agent binaries on it. The host sources a login shell before it accepts any
 * client, so the catalog is never served in that degraded state.
 */
test.describe("agent shell env loading", () => {
  test.skip(!ptyAvailable, "PTY sessions are unavailable on this machine")
  test.skip(!agentChatE2e, "disabled by GHARARGAH_ENABLE_AGENT_CHAT=0")

  test("a GUI-stripped PATH is recovered before the catalog is served", async () => {
    const { app, page } = await launchJet({
      env: {
        GHARARGAH_AGENT_MOCK: "1",
        GHARARGAH_AGENT_MOCK_SCENARIO: "echo",
        // Exactly what launchd hands a Finder-launched app.
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
        GHARARGAH_SHELL_ENV_FORCE: "1",
      },
    })
    try {
      const modal = await openNewNativeAgentSession(page, "codex")

      const modelPicker = modal.locator('[data-chat-provider-model-picker="true"]')
      await expectLocatorVisible(modelPicker)

      // Never "loading": enrichment completes before the WS server accepts clients,
      // so the first catalog a client can observe is already resolved.
      const catalog = await page.evaluate(() => window.gharargah!.agents!.listAgents())
      expect(catalog.shellEnvStatus).toBe("ready")
      expect(catalog.agents.length).toBeGreaterThan(0)

      const state = await page.evaluate(() => {
        const el = document.querySelector(
          '[data-chat-provider-model-picker="true"]',
        ) as HTMLButtonElement | null
        return {
          loading: el?.getAttribute("data-shell-env-loading") === "true",
          disabled: Boolean(el?.disabled),
        }
      })
      expect(state).toMatchObject({ loading: false, disabled: false })

      await modelPicker.click()
      await expectLocatorVisible(page.locator("[data-agent-setup-picker]"))
      await expectLocatorVisible(
        page.locator('[data-model-picker-row][data-model-picker-provider="codex"]').first(),
      )
    } finally {
      await app.close()
    }
  })

  test("with no agent CLI on PATH the picker still opens and explains why", async () => {
    const { app, page } = await launchJet({
      env: {
        // Opt out of enrichment so the stripped PATH survives and every agent
        // binary probe genuinely fails.
        GHARARGAH_SHELL_ENV_DISABLE: "1",
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      },
    })
    try {
      const modal = await openNewNativeAgentSession(page, "codex")

      const modelPicker = modal.locator('[data-chat-provider-model-picker="true"]')
      await expectLocatorVisible(modelPicker)

      const catalog = await page.evaluate(() => window.gharargah!.agents!.listAgents())
      expect(catalog.shellEnvStatus).toBe("ready")
      expect(catalog.agents.length).toBeGreaterThan(0)
      // Availability is per driver — `enabled` only says the agent is offered.
      for (const agent of catalog.agents) {
        expect(agent.drivers.length).toBeGreaterThan(0)
        for (const driver of agent.drivers) {
          expect(driver.status).toBe("unavailable")
        }
        expect(agent.drivers[0]?.message).toMatch(/not found on PATH/i)
      }

      // The switcher must still open so the user can see the unavailable state
      // rather than facing a dead control with no explanation.
      const pickerDisabled = await page.evaluate(() => {
        const el = document.querySelector(
          '[data-chat-provider-model-picker="true"]',
        ) as HTMLButtonElement | null
        return Boolean(el?.disabled)
      })
      expect(pickerDisabled).toBe(false)
      await modelPicker.click()
      await expectLocatorVisible(page.locator("[data-agent-setup-picker]"))
    } finally {
      await app.close()
    }
  })
})
