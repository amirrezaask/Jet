import { expect, test } from "@playwright/test"
import {
  expectLocatorContainsText,
  expectLocatorCount,
  expectLocatorVisible,
  expectSelectorVisible,
} from "../shell/assert.js"
import {
  ensureSidebarLayout,
  execCommand,
  hasPtySpawn,
  launchJet,
  openNewAgentSession,
} from "./_launch.js"

const ptyAvailable = hasPtySpawn()

async function closeOverlays(page: import("./_launch.js").ShellDriver): Promise<void> {
  await page
    .evaluate(async () => {
      await window.__yaadeAgent?.executeCommand("yaade.goHome")
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

  test("session start, permission, unread, and failure update sidebar sessions", async () => {
    const { app, page } = await launchJet()
    try {
      await ensureSidebarLayout(page)
      await expectSelectorVisible(page, "[data-yaade-mission-sidebar]")
      await openNewAgentSession(page)
      await expectSelectorVisible(page, "[data-yaade-terminal-modal]", {
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

      // Tool activity remains accepted by telemetry without adding a secondary
      // activity surface beside the session terminal.
      expect(
        await ingestAde(page, sessionId, "claude", {
          hook_event_name: "PostToolUse",
          session_id: "ade-native-session-1",
          tool_name: "Read",
          tool_input: { file_path: "src/index.ts" },
        }),
      ).toBe(204)

      await expectLocatorCount(
        page.locator("[data-yaade-agent-activity-rail]"),
        0,
      )
      await expectLocatorCount(
        page.locator("[data-yaade-agent-activity-timeline]"),
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
      await expectLocatorCount(page.locator("[data-yaade-terminal-modal]"), 0, {
        timeout: 10_000,
      })

      const sessionRow = page.locator(
        `[data-yaade-sidebar-session="${sessionId}"]`,
      )
      await expectLocatorVisible(sessionRow)
      await expectLocatorVisible(
        sessionRow.locator("[data-yaade-sidebar-unread-badge]"),
      )

      expect(
        await ingestAde(page, sessionId, "claude", {
          hook_event_name: "StopFailure",
          session_id: "ade-native-session-1",
          error: "boom",
        }),
      ).toBe(204)

      await execCommand(page, "notifications.show")
      await expectSelectorVisible(page, "[data-yaade-notification-center]", {
        timeout: 10_000,
      })
      await expectLocatorContainsText(
        page.locator("[data-yaade-notification-item]").first(),
        /failed|error|terminated/i,
      )
    } finally {
      await app.close()
    }
  })
})
