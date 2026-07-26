import { expect, test } from "@playwright/test"
import {
  expectLocatorCount,
  expectLocatorVisible,
  expectSelectorVisible,
} from "../shell/assert.js"
import { execCommand, hasPtySpawn, launchJet, openSettings } from "./_launch.js"

const ptyAvailable = hasPtySpawn()

test.describe("session layout", () => {
  test.skip(!ptyAvailable, "PTY sessions are unavailable on this machine")

  test("new tabs stay provider-neutral until the first message", async () => {
    const { app, page } = await launchJet({
      env: {
        GHARARGAH_AGENT_MOCK: "1",
        GHARARGAH_AGENT_MOCK_SCENARIO: "echo",
      },
    })
    try {
      await execCommand(page, "ui.setSessionLayout.tabs")
      const tabs = page.locator("[data-gharargah-session-tabs]")
      await expectLocatorVisible(tabs)
      await tabs.getByRole("button", { name: "New tab" }).click()

      const modal = page.locator("[data-gharargah-terminal-modal]")
      await expectLocatorVisible(modal)
      await expect
        .poll(() => modal.getAttribute("data-gharargah-session-mode"))
        .toBe("agent")
      await expect
        .poll(() =>
          modal.locator("[data-chat-driver]").getAttribute("data-chat-driver"),
        )
        .toBe("unknown")

      const beforeSend = await page.evaluate(async () => {
        const workspacePath =
          window.__gharargahAgent!.getState().activeWorkspace!
        const threads = await window.gharargah!.agents!.listThreads(
          `file://${workspacePath}`,
          workspacePath,
        )
        const raw = localStorage.getItem("gharargah-session-roster-v2")
        const roster = raw
          ? (JSON.parse(raw) as {
              sessions: Array<{
                agentId?: string
                agentDriverId?: string
                agentThreadId?: string
              }>
            })
          : null
        return {
          threadCount: threads.threads.length,
          session: roster?.sessions.at(-1) ?? null,
        }
      })
      expect(beforeSend.session).not.toEqual(
        expect.objectContaining({
          agentDriverId: expect.any(String),
          agentThreadId: expect.any(String),
        }),
      )

      await modal.locator("[data-chat-provider-model-picker]").click()
      const picker = page.locator("[data-agent-setup-picker]")
      await expectLocatorVisible(picker)
      for (const [provider, model] of [
        ["codex", "Mock Codex"],
        ["claude", "Sonnet"],
        ["opencode", "OpenCode"],
        ["cursor", "Composer"],
      ] as const) {
        await expectLocatorVisible(
          picker.locator(`[data-model-picker-row][data-model-picker-provider="${provider}"]`).first(),
        )
        await expect
          .poll(() => picker.textContent())
          .toContain(model)
      }

      await picker
        .locator('[data-model-picker-row][data-model-picker-provider="claude"]')
        .filter({ hasText: "Sonnet" })
        .first()
        .click()
      await expect
        .poll(() => page.locator("[data-agent-setup-picker]").count())
        .toBe(0)
      const stillUnbound = await page.evaluate(async () => {
        const workspacePath =
          window.__gharargahAgent!.getState().activeWorkspace!
        const threads = await window.gharargah!.agents!.listThreads(
          `file://${workspacePath}`,
          workspacePath,
        )
        return threads.threads.length
      })
      expect(stillUnbound).toBe(beforeSend.threadCount)

      const composer = modal.locator('[data-testid="composer-editor"]')
      await composer.fill("bind on first message")
      await modal.getByRole("button", { name: "Send message" }).click()
      await expect
        .poll(async () => {
          const raw = await page.evaluate(() =>
            localStorage.getItem("gharargah-session-roster-v2"),
          )
          if (!raw) return null
          const roster = JSON.parse(raw) as {
            sessions: Array<{
              agentId?: string
              agentDriverId?: string
              agentThreadId?: string
            }>
          }
          return roster.sessions.at(-1) ?? null
        })
        .toEqual(
          expect.objectContaining({
            agentId: "claude",
            agentDriverId: "claude:sdk",
            agentThreadId: expect.any(String),
          }),
        )
    } finally {
      await app.close()
    }
  })

  test("settings switches between cards and browser-style session tabs", async () => {
    const { app, page } = await launchJet()
    try {
      await execCommand(page, "ui.setSessionLayout.cards")
      await expect
        .poll(() =>
          page.evaluate(
            () => window.__gharargahAgent!.getState().sessionLayout,
          ),
        )
        .toBe("cards")
      await expectSelectorVisible(
        page,
        '[data-gharargah-session-layout="cards"]',
      )
      await expectLocatorCount(page.locator("[data-gharargah-session-tabs]"), 0)

      await openSettings(page)
      await page
        .locator('[data-gharargah-session-layout-option="tabs"]')
        .click()
      await expect
        .poll(() =>
          page.evaluate(
            () => window.__gharargahAgent!.getState().sessionLayout,
          ),
        )
        .toBe("tabs")
      await expectSelectorVisible(
        page,
        '[data-gharargah-session-layout="tabs"]',
      )
      await page.getByRole("button", { name: "Close settings" }).click()

      const tabs = page.locator("[data-gharargah-session-tabs]")
      await expectLocatorVisible(tabs)
      const newTab = tabs.getByRole("button", { name: "New tab" })
      await expectLocatorVisible(newTab)
      await expectLocatorCount(page.locator("[data-gharargah-home]"), 0)

      await newTab.click()

      await expectSelectorVisible(
        page,
        '[data-gharargah-terminal-modal][data-gharargah-session-presentation="inline"]',
        { timeout: 20_000 },
      )
      await expectSelectorVisible(page, '[data-gharargah-session-pane="agent"]', {
        timeout: 20_000,
      })
      await expectLocatorCount(page.locator("[data-gharargah-session-tab]"), 1)
      await expectLocatorCount(
        page.locator('[role="dialog"] [data-gharargah-terminal-modal]'),
        0,
      )

      const firstTabId = await page
        .locator("[data-gharargah-session-tab]")
        .first()
        .getAttribute("data-gharargah-session-tab")
      expect(firstTabId).toBeTruthy()

      const firstTab = page.locator(
        `[data-gharargah-session-tab="${firstTabId}"]`,
      )
      await expect
        .poll(() =>
          page.evaluate(() => {
            const tablist = document.querySelector(
              "[data-gharargah-session-tabs] [role=tablist]",
            )
            const newTabButton = document.querySelector(
              "[data-gharargah-session-tab-new]",
            )
            return tablist?.nextElementSibling === newTabButton
          }),
        )
        .toBe(true)
      await newTab.click()
      await expectSelectorVisible(
        page,
        '[data-gharargah-terminal-modal][data-gharargah-session-presentation="inline"]',
      )
      await expectLocatorCount(page.locator("[data-gharargah-home]"), 0)
      await expectLocatorCount(
        page.locator("[data-gharargah-session-tab]"),
        2,
        {
          timeout: 20_000,
        },
      )
      const secondTabId = await page
        .locator("[data-gharargah-session-tab]")
        .last()
        .getAttribute("data-gharargah-session-tab")
      expect(secondTabId).toBeTruthy()

      await firstTab.click()
      await expect
        .poll(() => firstTab.getAttribute("aria-selected"))
        .toBe("true")
      await expectSelectorVisible(
        page,
        '[data-gharargah-terminal-modal][data-gharargah-session-presentation="inline"]',
      )
      await page.setViewportSize({ width: 390, height: 844 })
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        )
        .toBe(true)
      await expectSelectorVisible(page, "[data-gharargah-session-tabs]")
      await expectSelectorVisible(page, "[data-gharargah-session-mode-switch]")
      await expect
        .poll(() =>
          page.evaluate(() => {
            const modal = document.querySelector(
              "[data-gharargah-terminal-modal]",
            )
            const body = modal?.querySelector(
              "[data-gharargah-terminal-modal-body]",
            )
            const footer = document.querySelector(
              "[data-gharargah-terminal-modal-header]",
            )
            const tabs = document.querySelector("[data-gharargah-session-tabs]")
            if (!body || !footer || !tabs) return false
            const tabsBeforeBody =
              (tabs.compareDocumentPosition(body) &
                Node.DOCUMENT_POSITION_FOLLOWING) !==
              0
            const bodyBeforeFooter =
              (body.compareDocumentPosition(footer) &
                Node.DOCUMENT_POSITION_FOLLOWING) !==
              0
            return tabsBeforeBody && bodyBeforeFooter
          }),
        )
        .toBe(true)
      await page.setViewportSize({ width: 1440, height: 900 })
      await page
        .locator(`[data-gharargah-session-tab-close="${secondTabId}"]`)
        .click()
      await expectLocatorCount(page.locator("[data-gharargah-session-tab]"), 1)
      await expectLocatorCount(page.locator("[data-gharargah-home]"), 0)
      await expect
        .poll(() =>
          page.evaluate(() => {
            const raw = localStorage.getItem("jet-appearance-settings")
            return raw ? JSON.parse(raw).sessionLayout : null
          }),
        )
        .toBe("tabs")

      await page.reload({ waitUntil: "domcontentloaded" })
      await page.waitForFunction(() => window.__gharargahAgent != null, null, {
        timeout: 30_000,
      })
      await page.evaluate(() => window.__gharargahAgent!.waitForReady())
      await expect
        .poll(() =>
          page.evaluate(
            () => window.__gharargahAgent!.getState().sessionLayout,
          ),
        )
        .toBe("tabs")
      await expectSelectorVisible(page, "[data-gharargah-session-tabs]")

      await openSettings(page)
      await page
        .locator('[data-gharargah-session-layout-option="cards"]')
        .click()
      await expect
        .poll(() =>
          page.evaluate(
            () => window.__gharargahAgent!.getState().sessionLayout,
          ),
        )
        .toBe("cards")
      await expectLocatorCount(page.locator("[data-gharargah-session-tabs]"), 0)
      await page.getByRole("button", { name: "Close settings" }).click()
      await expectSelectorVisible(page, "[data-gharargah-home]")
    } finally {
      await app.close()
    }
  })
})
