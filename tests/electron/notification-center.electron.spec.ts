import { expect, test } from "@playwright/test"
import {
  expectLocatorContainsText,
  expectLocatorCount,
  expectLocatorVisible,
  expectSelectorVisible,
} from "../shell/assert.js"
import { execCommand, launchJet, openNewAgentSession } from "./_launch.js"

async function closeOverlays(page: import("./_launch.js").ShellDriver): Promise<void> {
  await page.evaluate(async () => {
    await window.__gharargahAgent?.executeCommand("gharargah.goHome")
  }).catch(() => {})
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Escape")
    await page.waitForTimeout(150)
  }
}

async function openCenter(page: import("./_launch.js").ShellDriver): Promise<void> {
  await execCommand(page, "notifications.show")
  await expectSelectorVisible(page, "[data-gharargah-notification-center]", {
    timeout: 10_000,
  })
}

test.describe("notification center", () => {
  test("ingest creates unread badge, panel, and open-session flow", async () => {
    const { app, page } = await launchJet()
    try {
      await expectSelectorVisible(page, "[data-gharargah-home], [data-gharargah-mission-sidebar]")
      await expectSelectorVisible(page, "[data-gharargah-notification-bell]")

      await openNewAgentSession(page)
      await expectSelectorVisible(page, "[data-gharargah-terminal-modal]", {
        timeout: 20_000,
      })
      await closeOverlays(page)
      await expectLocatorCount(page.locator("[data-gharargah-terminal-modal]"), 0, {
        timeout: 10_000,
      })

      let sessionId: string | null = null
      await expect
        .poll(async () => {
          sessionId = await page.evaluate(async () => {
            const res = await fetch("/api/v1/sessions")
            if (!res.ok) return null
            const roster = (await res.json()) as { sessions: Array<{ tabId: string }> }
            return roster.sessions[0]?.tabId ?? null
          })
          return sessionId
        }, { timeout: 20_000 })
        .toBeTruthy()

      const state = await page.evaluate(() => window.__gharargahAgent!.getState())
      const projectName = state.workspaces[0]?.name ?? "sample-workspace"
      const projectId = state.workspaces[0]?.id ?? state.workspaces[0]?.path ?? null

      await page.evaluate(
        async ({ sessionId: sid, projectId: pid, projectName: pname }) => {
          const result = await window.__gharargahAgent!.ingestNotification!({
            source: "provider-hook",
            type: "turn-completed",
            title: "Claude completed the turn",
            message: "Refactor authentication finished",
            sessionId: sid,
            projectId: pid,
            projectName: pname,
            sessionTitle: "Refactor authentication",
            provider: "claude",
            eventId: `e2e-turn-${Date.now()}`,
          })
          return result
        },
        { sessionId, projectId, projectName },
      )

      await expect
        .poll(async () => {
          const counts = await page.evaluate(() =>
            window.__gharargahAgent!.getNotificationCounts!(),
          )
          return counts.totalUnread
        }, { timeout: 15_000 })
        .toBeGreaterThan(0)

      await expectLocatorVisible(page.locator("[data-gharargah-notification-badge]"))

      await openCenter(page)
      await expectLocatorContainsText(
        page.locator("[data-gharargah-notification-item]").first(),
        "Claude completed the turn",
      )
      await expectLocatorContainsText(
        page.locator("[data-gharargah-notification-item]").first(),
        projectName,
      )

      await page.locator("[data-gharargah-notification-item] button").first().click()
      await expectSelectorVisible(page, "[data-gharargah-terminal-modal]", {
        timeout: 10_000,
      })

      await closeOverlays(page)
      await openCenter(page)
      const item = page.locator("[data-gharargah-notification-item]").first()
      await expect
        .poll(async () => item.getAttribute("data-unread"), { timeout: 10_000 })
        .toBe("false")
    } finally {
      await app.close()
    }
  })

  test("permission resolve + mark-all-read keep history semantics", async () => {
    const { app, page } = await launchJet()
    try {
      await expectSelectorVisible(page, "[data-gharargah-home], [data-gharargah-mission-sidebar]")
      await openNewAgentSession(page)
      await closeOverlays(page)

      let sessionId: string | null = null
      await expect
        .poll(async () => {
          sessionId = await page.evaluate(async () => {
            const res = await fetch("/api/v1/sessions")
            if (!res.ok) return null
            return (
              ((await res.json()) as { sessions: Array<{ tabId: string }> }).sessions[0]
                ?.tabId ?? null
            )
          })
          return sessionId
        }, { timeout: 20_000 })
        .toBeTruthy()

      const eventId = `perm-e2e-${Date.now()}`
      await page.evaluate(
        async ({ sid, eventId: eid }) => {
          await window.__gharargahAgent!.ingestNotification!({
            source: "provider-hook",
            type: "permission-required",
            title: "Claude requested permission",
            sessionId: sid,
            provider: "claude",
            eventId: eid,
          })
        },
        { sid: sessionId, eventId },
      )

      await openCenter(page)
      await page.locator('[data-gharargah-notification-filter="action-needed"]').click()
      await expectLocatorContainsText(
        page.locator("[data-gharargah-notification-item]").first(),
        "permission",
      )

      await page.evaluate(
        async ({ sid, eventId: eid }) => {
          await window.__gharargahAgent!.ingestNotification!({
            source: "provider-hook",
            type: "permission-required",
            title: "Permission answered",
            sessionId: sid,
            resolveOf: { type: "permission-required", eventId: eid },
          })
          await window.__gharargahAgent!.ingestNotification!({
            source: "provider-hook",
            type: "turn-completed",
            title: "Claude completed the turn",
            sessionId: sid,
            eventId: `turn-e2e-${Date.now()}`,
          })
        },
        { sid: sessionId, eventId },
      )

      await page.locator('[data-gharargah-notification-filter="all"]').click()
      await page.locator("[data-gharargah-notification-mark-all-read]").click()

      await page.locator('[data-gharargah-notification-filter="action-needed"]').click()
      await expectSelectorVisible(page, "[data-gharargah-notification-empty]")

      await page.locator('[data-gharargah-notification-filter="completed"]').click()
      await expectLocatorContainsText(
        page.locator("[data-gharargah-notification-item]").first(),
        "completed",
      )
    } finally {
      await app.close()
    }
  })

  test("hook + osc dedupe; refresh keeps counts", async () => {
    const { app, page } = await launchJet()
    try {
      await expectSelectorVisible(page, "[data-gharargah-home], [data-gharargah-mission-sidebar]")
      await openNewAgentSession(page)
      await closeOverlays(page)

      let sessionId: string | null = null
      await expect
        .poll(async () => {
          sessionId = await page.evaluate(async () => {
            const res = await fetch("/api/v1/sessions")
            if (!res.ok) return null
            return (
              ((await res.json()) as { sessions: Array<{ tabId: string }> }).sessions[0]
                ?.tabId ?? null
            )
          })
          return sessionId
        }, { timeout: 20_000 })
        .toBeTruthy()

      const turnId = `turn-dup-${Date.now()}`
      await page.evaluate(
        async ({ sid, turnId: tid }) => {
          await window.__gharargahAgent!.ingestNotification!({
            source: "osc",
            type: "turn-completed",
            title: "Turn complete",
            sessionId: sid,
            provider: "codex",
            providerTurnId: tid,
            eventId: tid,
          })
          await window.__gharargahAgent!.ingestNotification!({
            source: "provider-hook",
            type: "turn-completed",
            title: "Codex completed the turn",
            sessionId: sid,
            provider: "codex",
            providerTurnId: tid,
            eventId: tid,
          })
        },
        { sid: sessionId, turnId },
      )

      await openCenter(page)
      await page.locator('[data-gharargah-notification-filter="completed"]').click()
      await expect
        .poll(async () => page.locator("[data-gharargah-notification-item]").count())
        .toBe(1)
      await expectLocatorContainsText(
        page.locator("[data-gharargah-notification-item]"),
        "Codex completed",
      )

      const unreadBefore = await page.evaluate(() =>
        window.__gharargahAgent!.getNotificationCounts!(),
      )

      await page.reload()
      await page.waitForFunction(() => window.__gharargahAgent != null, null, {
        timeout: 30_000,
      })
      await page.evaluate(() => window.__gharargahAgent!.waitForReady())
      await expect
        .poll(async () => {
          const counts = await page.evaluate(() =>
            window.__gharargahAgent!.getNotificationCounts!(),
          )
          return counts.totalUnread
        }, { timeout: 15_000 })
        .toBe(unreadBefore.totalUnread)
    } finally {
      await app.close()
    }
  })
})
