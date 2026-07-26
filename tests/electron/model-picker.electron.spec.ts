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

  test("opens with persisted favorites without React #185 crash", async () => {
    const { app, page } = await launchJet({
      env: {
        GHARARGAH_AGENT_MOCK: "1",
        GHARARGAH_AGENT_MOCK_SCENARIO: "echo",
      },
    })
    try {
      // Persist favorites before mounting ModelPickerContent. A buggy
      // useSyncExternalStore getSnapshot that re-parses localStorage every
      // read causes React error #185 as soon as the picker opens.
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
      await expectLocatorVisible(page.locator('[data-model-picker-sidebar="true"]'))
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

      // Switch providers inside the open picker — exercises list remounts
      // while favorites remain loaded from the stable client-settings store.
      await picker.locator('[data-model-picker-provider="claude"]').click()
      await expect.poll(() => picker.textContent()).toContain("Sonnet")

      const pageErrors = await page.evaluate(() => {
        const w = window as Window & { __pickerErrors?: string[] }
        return w.__pickerErrors ?? []
      })
      expect(
        pageErrors.some(
          text =>
            text.includes("#185") ||
            text.includes("Maximum update depth") ||
            text.includes("renderer crashed"),
        ),
      ).toBe(false)
      await expectLocatorCount(page.locator("text=Something went wrong"), 0)
      await expectLocatorVisible(picker)
    } finally {
      await app.close()
    }
  })
})
