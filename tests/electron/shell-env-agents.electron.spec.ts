import { expect, test } from "@playwright/test"
import {
  expectLocatorVisible,
} from "../shell/assert.js"
import {
  clickNewSession,
  hasPtySpawn,
  launchJet,
} from "./_launch.js"

const ptyAvailable = hasPtySpawn()
const agentChatE2e = process.env.GHARARGAH_ENABLE_AGENT_CHAT === "1"

test.describe("agent shell env loading", () => {
  test.skip(!ptyAvailable, "PTY sessions are unavailable on this machine")
  test.skip(!agentChatE2e, "requires GHARARGAH_ENABLE_AGENT_CHAT=1")

  test("switcher stays loading until login-shell PATH is ready", async () => {
    const { app, page } = await launchJet({
      env: {
        GHARARGAH_AGENT_MOCK: "1",
        GHARARGAH_AGENT_MOCK_SCENARIO: "echo",
        // Force lazy path even when the e2e process already has a rich PATH.
        JET_SHELL_ENV_FORCE: "1",
        JET_SHELL_ENV_DELAY_MS: "1200",
        JET_SHELL_ENV_MOCK_PATH: process.env.PATH ?? "/usr/bin:/bin",
      },
    })
    try {
      await clickNewSession(page)
      const modal = page.locator("[data-gharargah-terminal-modal]")
      await modal.waitFor({ state: "visible", timeout: 20_000 })
      await page.waitForFunction(
        () =>
          document
            .querySelector("[data-gharargah-terminal-modal]")
            ?.getAttribute("data-gharargah-session-mode") === "agent",
        null,
        { timeout: 20_000 },
      )

      const modelPicker = modal.locator('[data-chat-provider-model-picker="true"]')
      await expectLocatorVisible(modelPicker)

      // While shell env resolves, catalog is empty and the switcher is locked.
      await expect
        .poll(
          async () =>
            page.evaluate(() => {
              const el = document.querySelector(
                '[data-chat-provider-model-picker="true"]',
              ) as HTMLButtonElement | null
              return {
                loading: el?.getAttribute("data-shell-env-loading") === "true",
                disabled: Boolean(el?.disabled),
                status: null as string | null,
              }
            }),
          { timeout: 5_000 },
        )
        .toMatchObject({ loading: true, disabled: true })

      const loadingCatalog = await page.evaluate(() =>
        window.gharargah!.agents!.listAgents(),
      )
      if (loadingCatalog.shellEnvStatus === "loading") {
        expect(loadingCatalog.agents).toEqual([])
      }

      await expect
        .poll(
          async () =>
            page.evaluate(() => {
              const el = document.querySelector(
                '[data-chat-provider-model-picker="true"]',
              ) as HTMLButtonElement | null
              return {
                loading: el?.getAttribute("data-shell-env-loading") === "true",
                disabled: Boolean(el?.disabled),
              }
            }),
          { timeout: 15_000 },
        )
        .toMatchObject({ loading: false, disabled: false })

      const readyCatalog = await page.evaluate(() =>
        window.gharargah!.agents!.listAgents(),
      )
      expect(readyCatalog.shellEnvStatus).toBe("ready")
      expect(readyCatalog.agents.length).toBeGreaterThan(0)

      await modelPicker.click()
      await expectLocatorVisible(page.locator("[data-agent-setup-picker]"))
      await expectLocatorVisible(
        page.locator('[data-model-picker-row][data-model-picker-provider="codex"]').first(),
      )
    } finally {
      await app.close()
    }
  })

  test("switcher enables after shell env ready even when no agent CLI is on PATH", async () => {
    const { app, page } = await launchJet({
      env: {
        // No AGENT_MOCK — catalog reflects real which(1) against the mock PATH.
        JET_SHELL_ENV_FORCE: "1",
        JET_SHELL_ENV_DELAY_MS: "800",
        // Stripped PATH with no agent binaries → all agents unavailable.
        JET_SHELL_ENV_MOCK_PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      },
    })
    try {
      await clickNewSession(page)
      const modal = page.locator("[data-gharargah-terminal-modal]")
      await modal.waitFor({ state: "visible", timeout: 20_000 })
      await page.waitForFunction(
        () =>
          document
            .querySelector("[data-gharargah-terminal-modal]")
            ?.getAttribute("data-gharargah-session-mode") === "agent",
        null,
        { timeout: 20_000 },
      )

      const modelPicker = modal.locator('[data-chat-provider-model-picker="true"]')
      await expectLocatorVisible(modelPicker)

      await expect
        .poll(
          async () =>
            page.evaluate(() => {
              const el = document.querySelector(
                '[data-chat-provider-model-picker="true"]',
              ) as HTMLButtonElement | null
              return {
                loading: el?.getAttribute("data-shell-env-loading") === "true",
                disabled: Boolean(el?.disabled),
              }
            }),
          { timeout: 15_000 },
        )
        .toMatchObject({ loading: false, disabled: false })

      const catalog = await page.evaluate(() => window.gharargah!.agents!.listAgents())
      expect(catalog.shellEnvStatus).toBe("ready")
      // No CLIs — but switcher must still open so the user sees unavailable state.
      expect(catalog.agents.every(agent => !agent.enabled)).toBe(true)

      await modelPicker.click()
      await expectLocatorVisible(page.locator("[data-agent-setup-picker]"))
    } finally {
      await app.close()
    }
  })
})
