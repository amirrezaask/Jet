/**
 * The per-agent CLI ↔ native driver switch in the new-session picker.
 * CLI mode must launch a PTY; native mode must open the in-app chat surface
 * bound to that agent's headless driver, and the choice must survive a reload.
 */
import { expect, test } from "@playwright/test"
import {
  expectLocatorCount,
  expectLocatorVisible,
} from "../shell/assert.js"
import type { ShellDriver } from "../shell/driver.js"
import {
  clickNewSession,
  hasPtySpawn,
  launchJet,
  openNewCliSession,
  openNewNativeAgentSession,
  pickAgentCli,
} from "./_launch.js"

const agentChatE2e = process.env.GHARARGAH_ENABLE_AGENT_CHAT !== "0"

const nativeDriverIds: Record<string, string> = {
  codex: "codex:app-server",
  claude: "claude:sdk",
  opencode: "opencode:sdk",
  cursor: "cursor:acp",
}

type RosterSession = {
  tabId: string
  agentId?: string
  agentDriverId?: string
  launchCommand?: string
  ptyId?: string
}

async function latestSessionForAgent(
  page: ShellDriver,
  agentId: string,
): Promise<RosterSession | null> {
  return page.evaluate(async id => {
    const res = await fetch("/api/v1/sessions")
    if (!res.ok) return null
    const roster = (await res.json()) as { sessions: RosterSession[] }
    return [...roster.sessions].reverse().find(item => item.agentId === id) ?? null
  }, agentId)
}

async function readDriverModeSelection(
  page: ShellDriver,
  agentId: string,
): Promise<{ cli: string | null; native: string | null }> {
  return page.evaluate(id => {
    const read = (mode: string) =>
      document
        .querySelector(`[data-gharargah-agent-driver-mode-option="${id}:${mode}"]`)
        ?.getAttribute("aria-checked") ?? null
    return { cli: read("cli"), native: read("native") }
  }, agentId)
}

test.describe("agent driver mode switch", () => {
  test.skip(!hasPtySpawn(), "the session picker requires a PTY-capable host")
  test.skip(!agentChatE2e, "native driver mode requires GHARARGAH_ENABLE_AGENT_CHAT")

  test("picker defaults every agent to CLI and advertises its native driver id", async () => {
    const { app, page } = await launchJet({ env: { GHARARGAH_AGENT_MOCK: "1" } })
    try {
      await clickNewSession(page)
      await expectLocatorVisible(
        page.locator('[data-gharargah-agent-cli-option="codex"]'),
        { timeout: 20_000 },
      )

      for (const agentId of Object.keys(nativeDriverIds)) {
        const group = page.locator(
          `[data-gharargah-agent-driver-mode-group="${agentId}"]`,
        )
        await expectLocatorCount(group, 1)
        expect(await readDriverModeSelection(page, agentId)).toEqual({
          cli: "true",
          native: "false",
        })
      }

      // Flipping to native re-labels the row with the headless driver it will use.
      for (const [agentId, driverId] of Object.entries(nativeDriverIds)) {
        await page
          .locator(`[data-gharargah-agent-driver-mode-option="${agentId}:native"]`)
          .click()
        const row = page
          .locator(`[data-gharargah-agent-cli-option="${agentId}"]`)
          .locator("xpath=../..")
        await expect.poll(() => row.textContent()).toContain(driverId)
      }
    } finally {
      await app.close()
    }
  })

  test("CLI mode launches a PTY and never mounts the in-app composer", async () => {
    const { app, page } = await launchJet({ env: { GHARARGAH_AGENT_MOCK: "1" } })
    try {
      const modal = await openNewCliSession(page, "codex")
      await expectLocatorVisible(
        modal.locator("[data-gharargah-terminal-panel]"),
        { timeout: 20_000 },
      )
      await expectLocatorCount(modal.locator('[data-testid="composer-editor"]'), 0)

      await expect
        .poll(async () => (await latestSessionForAgent(page, "codex"))?.agentDriverId, {
          timeout: 20_000,
        })
        .toBe("codex:cli")
      const session = await latestSessionForAgent(page, "codex")
      expect(session?.launchCommand).toBeTruthy()
    } finally {
      await app.close()
    }
  })

  test("native mode opens the in-app chat with no PTY behind it", async () => {
    const { app, page } = await launchJet({ env: { GHARARGAH_AGENT_MOCK: "1" } })
    try {
      const modal = await openNewNativeAgentSession(page, "codex")
      await expectLocatorVisible(modal.locator('[data-testid="composer-editor"]'))
      await expectLocatorVisible(modal.locator("[data-messages-timeline]"))
      await expectLocatorCount(
        modal.locator("[data-gharargah-terminal-panel] .xterm"),
        0,
      )
      await expect
        .poll(() => modal.locator("[data-chat-driver]").getAttribute("data-chat-driver"))
        .toBe("codex:app-server")

      await expect
        .poll(async () => (await latestSessionForAgent(page, "codex"))?.agentDriverId, {
          timeout: 20_000,
        })
        .toBe("codex:app-server")
      const session = await latestSessionForAgent(page, "codex")
      expect(session?.launchCommand).toBeFalsy()
      expect(session?.ptyId).toBeFalsy()
    } finally {
      await app.close()
    }
  })

  test("driver mode is per agent and survives a reload", async () => {
    const { app, page } = await launchJet({ env: { GHARARGAH_AGENT_MOCK: "1" } })
    try {
      await clickNewSession(page)
      await expectLocatorVisible(
        page.locator('[data-gharargah-agent-cli-option="codex"]'),
        { timeout: 20_000 },
      )
      await page
        .locator('[data-gharargah-agent-driver-mode-option="codex:native"]')
        .click()
      await expect
        .poll(() => readDriverModeSelection(page, "codex"))
        .toEqual({ cli: "false", native: "true" })
      // Switching one agent must not move the others.
      expect(await readDriverModeSelection(page, "claude")).toEqual({
        cli: "true",
        native: "false",
      })
      await page.keyboard.press("Escape")

      await page.reload()
      await page.waitForFunction(() => window.__gharargahAgent != null, null, {
        timeout: 30_000,
      })
      await page.evaluate(() => window.__gharargahAgent!.waitForReady())

      await clickNewSession(page)
      await expectLocatorVisible(
        page.locator('[data-gharargah-agent-cli-option="codex"]'),
        { timeout: 20_000 },
      )
      expect(await readDriverModeSelection(page, "codex")).toEqual({
        cli: "false",
        native: "true",
      })
      expect(await readDriverModeSelection(page, "claude")).toEqual({
        cli: "true",
        native: "false",
      })

      // The remembered choice drives the next session without re-picking a mode.
      await pickAgentCli(page, "codex")
      const modal = page.locator("[data-gharargah-terminal-modal]")
      await modal.waitFor({ state: "visible", timeout: 20_000 })
      await expectLocatorVisible(modal.locator('[data-testid="composer-editor"]'), {
        timeout: 20_000,
      })
    } finally {
      await app.close()
    }
  })

  test("a native session survives reload and reopens as in-app chat", async () => {
    const { app, page } = await launchJet({ env: { GHARARGAH_AGENT_MOCK: "1" } })
    try {
      const modal = await openNewNativeAgentSession(page, "codex")
      await expectLocatorVisible(modal.locator('[data-testid="composer-editor"]'))
      const tabId = (await latestSessionForAgent(page, "codex"))?.tabId
      expect(tabId).toBeTruthy()

      await page.locator("[data-gharargah-terminal-modal-close]").click()
      await expectLocatorCount(modal, 0)

      await page.reload()
      await page.waitForFunction(() => window.__gharargahAgent != null, null, {
        timeout: 30_000,
      })
      await page.evaluate(() => window.__gharargahAgent!.waitForReady())

      // Regression: the roster decoder used to drop agent sessions with no
      // launch command, wiping every native session on reload.
      await expect
        .poll(async () => (await latestSessionForAgent(page, "codex"))?.agentDriverId, {
          timeout: 20_000,
        })
        .toBe("codex:app-server")

      const card = page
        .locator("[data-gharargah-session-card]")
        .filter({ hasText: "Codex" })
        .first()
      await expectLocatorVisible(card, { timeout: 20_000 })
      await card.click()
      const reopened = page.locator("[data-gharargah-terminal-modal]")
      await expectLocatorVisible(reopened, { timeout: 20_000 })
      await expect.poll(() => reopened.getAttribute("data-gharargah-session-mode")).toBe("agent")
      await expectLocatorVisible(reopened.locator('[data-testid="composer-editor"]'), {
        timeout: 20_000,
      })
      await expectLocatorCount(
        reopened.locator("[data-gharargah-terminal-panel] .xterm"),
        0,
      )
    } finally {
      await app.close()
    }
  })
})
