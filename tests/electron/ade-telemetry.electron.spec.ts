import { expect, test } from "@playwright/test"
import {
  expectLocatorContainsText,
  expectLocatorCount,
  expectLocatorVisible,
  expectSelectorVisible,
} from "../shell/assert.js"
import {
  ensureCardsLayout,
  execCommand,
  hasPtySpawn,
  launchJet,
  openNewAgentSession,
} from "./_launch.js"

const ptyAvailable = hasPtySpawn()

async function closeOverlays(page: import("./_launch.js").ShellDriver): Promise<void> {
  await page
    .evaluate(async () => {
      await window.__gharargahAgent?.executeCommand("gharargah.goHome")
    })
    .catch(() => {})
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Escape")
    await page.waitForTimeout(150)
  }
}

async function waitForSessionId(
  page: import("./_launch.js").ShellDriver,
): Promise<string> {
  let sessionId = ""
  await expect
    .poll(async () => {
      sessionId =
        (await page.evaluate(async () => {
          const res = await fetch("/api/v1/sessions")
          if (!res.ok) return null
          return (
            ((await res.json()) as { sessions: Array<{ tabId: string }> })
              .sessions[0]?.tabId ?? null
          )
        })) ?? ""
      return sessionId || null
    }, { timeout: 20_000 })
    .toBeTruthy()
  return sessionId
}

async function ingestAde(
  page: import("./_launch.js").ShellDriver,
  sessionId: string,
  provider: string,
  body: Record<string, unknown>,
): Promise<number> {
  return page.evaluate(
    async ({ sid, provider: p, body: b }) => {
      const url = new URL("/api/v1/notifications/ingest", window.location.origin)
      url.searchParams.set("provider", p)
      url.searchParams.set("sessionId", sid)
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(b),
      })
      return response.status
    },
    { sid: sessionId, provider, body },
  )
}

test.describe("ADE telemetry", () => {
  test.skip(!ptyAvailable, "node-pty cannot spawn a shell on this machine")

  test("session start, permission, unread, failure cards + activity timeline", async () => {
    const { app, page } = await launchJet()
    try {
      await ensureCardsLayout(page)
      await expectSelectorVisible(page, "[data-gharargah-home]")
      await openNewAgentSession(page)
      await expectSelectorVisible(page, "[data-gharargah-terminal-modal]", {
        timeout: 20_000,
      })

      const sessionId = await waitForSessionId(page)

      expect(
        await ingestAde(page, sessionId, "claude", {
          hook_event_name: "SessionStart",
          session_id: "ade-native-session-1",
          source: "startup",
        }),
      ).toBe(204)

      await expect
        .poll(async () =>
          page.evaluate(async () => {
            const res = await fetch("/api/v1/sessions")
            if (!res.ok) return null
            return (
              ((await res.json()) as {
                sessions: Array<{ agentCliSessionId?: string }>
              }).sessions[0]?.agentCliSessionId ?? null
            )
          }),
        { timeout: 15_000 })
        .toBe("ade-native-session-1")

      // Lifecycle events are stored but hidden in the timeline UI — ingest a tool
      // event so the activity pane has a visible row.
      expect(
        await ingestAde(page, sessionId, "claude", {
          hook_event_name: "PostToolUse",
          session_id: "ade-native-session-1",
          tool_name: "Read",
          tool_input: { file_path: "src/index.ts" },
        }),
      ).toBe(204)

      await expectSelectorVisible(page, "[data-gharargah-agent-activity-timeline]", {
        timeout: 10_000,
      })
      await expect
        .poll(
          async () =>
            page.locator("[data-gharargah-agent-activity-row]").count(),
          { timeout: 10_000 },
        )
        .toBeGreaterThan(0)
      await expectLocatorCount(
        page.locator(
          '[data-gharargah-agent-activity-row][data-kind="process.started"]',
        ),
        0,
      )

      expect(
        await ingestAde(page, sessionId, "claude", {
          hook_event_name: "PermissionRequest",
          session_id: "ade-native-session-1",
          permission_id: "perm-ade-1",
          tool_name: "Bash",
        }),
      ).toBe(204)

      await closeOverlays(page)
      await expectLocatorCount(page.locator("[data-gharargah-terminal-modal]"), 0, {
        timeout: 10_000,
      })

      const card = page
        .locator("[data-gharargah-terminal-card]:not([data-gharargah-new-session])")
        .first()
      await expectLocatorVisible(card)
      await expect
        .poll(async () =>
          card.locator("[data-gharargah-status-badge]").getAttribute("data-status"),
        { timeout: 15_000 })
        .toBe("approval")
      await expectLocatorVisible(card.locator("[data-gharargah-session-unread]"))

      expect(
        await ingestAde(page, sessionId, "claude", {
          hook_event_name: "StopFailure",
          session_id: "ade-native-session-1",
          error: "boom",
        }),
      ).toBe(204)

      await expect
        .poll(async () =>
          card.locator("[data-gharargah-status-badge]").getAttribute("data-status"),
        { timeout: 15_000 })
        .toBe("failed")

      await execCommand(page, "notifications.show")
      await expectSelectorVisible(page, "[data-gharargah-notification-center]", {
        timeout: 10_000,
      })
      await expectLocatorVisible(
        page.locator('[data-gharargah-notification-filter="action-needed"]'),
      )
      await expectLocatorVisible(
        page.locator('[data-gharargah-notification-filter="completed"]'),
      )
      await expectLocatorVisible(
        page.locator('[data-gharargah-notification-filter="errors"]'),
      )

      await page.locator('[data-gharargah-notification-filter="errors"]').click()
      await expectLocatorContainsText(
        page.locator("[data-gharargah-notification-item]").first(),
        /failed|error|terminated/i,
      )
    } finally {
      await app.close()
    }
  })
})
