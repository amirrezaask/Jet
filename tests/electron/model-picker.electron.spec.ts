import { expect, test } from "@playwright/test"
import {
  expectLocatorCount,
  expectLocatorVisible,
} from "../shell/assert.js"
import { hasPtySpawn, launchJet, openNewAgentSession } from "./_launch.js"

const ptyAvailable = hasPtySpawn()
const agentChatE2e = process.env.GHARARGAH_ENABLE_AGENT_CHAT !== "0"

test.describe("composer model picker", () => {
  test.skip(!ptyAvailable, "PTY sessions are unavailable on this machine")
  test.skip(!agentChatE2e, "requires GHARARGAH_ENABLE_AGENT_CHAT!=0")

  test("opens searchable flat model list without React #185 crash", async () => {
    const { app, page } = await launchJet({
      env: {
        GHARARGAH_AGENT_MOCK: "1",
        GHARARGAH_AGENT_MOCK_SCENARIO: "echo",
      },
    })
    try {
      await page.evaluate(() => {
        localStorage.setItem(
          "jet-agent-client-settings",
          JSON.stringify({
            favorites: [
              { provider: "codex", model: "mock-codex" },
              { provider: "claude", model: "sonnet" },
            ],
          }),
        )
        const w = window as Window & { __pickerErrors?: string[] }
        w.__pickerErrors = []
        const push = (message: string) => {
          w.__pickerErrors!.push(message)
        }
        window.addEventListener("error", event => {
          push(event.message)
        })
        const originalError = console.error.bind(console)
        console.error = (...args: unknown[]) => {
          push(args.map(arg => (arg instanceof Error ? arg.message : String(arg))).join(" "))
          originalError(...args)
        }
      })

      const modal = await openNewAgentSession(page, "codex")

      const modelPicker = modal.locator('[data-chat-provider-model-picker="true"]')
      await expectLocatorVisible(modelPicker)

      await modelPicker.click()
      const picker = page.locator("[data-agent-setup-picker]")
      await expectLocatorVisible(picker)
      await expectLocatorVisible(page.locator("[data-model-picker-content]"))
      await expectLocatorVisible(page.locator('[data-gharargah-list-panel="agent-model-switcher"]'))
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              document.querySelector(
                '[data-model-picker-content] input[placeholder*="Search models"]',
              ) != null,
          ),
        )
        .toBe(true)

      await expectLocatorVisible(
        picker.locator('[data-model-picker-row][data-model-picker-provider="codex"]').first(),
      )
      const claudeRow = picker
        .locator('[data-model-picker-row][data-model-picker-provider="claude"]')
        .first()
      await expectLocatorVisible(claudeRow)
      await claudeRow.click()
      await expect
        .poll(() => modal.locator("[data-chat-provider]").getAttribute("data-chat-provider"), {
          timeout: 10_000,
        })
        .toBe("claude")

      const pageErrors = await page.evaluate(() => {
        const w = window as Window & { __pickerErrors?: string[] }
        return w.__pickerErrors ?? []
      })
      expect(pageErrors.filter(message => message.includes("Maximum update depth"))).toHaveLength(0)
    } finally {
      await app.close()
    }
  })
})
