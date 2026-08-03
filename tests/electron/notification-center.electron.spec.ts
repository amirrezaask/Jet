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
    await window.__yaadeAgent?.executeCommand("yaade.goHome")
  }).catch(() => {})
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Escape")
    await page.waitForTimeout(150)
  }
}

async function openCenter(page: import("./_launch.js").ShellDriver): Promise<void> {
  await execCommand(page, "notifications.show")
  await expectSelectorVisible(page, "[data-yaade-notification-center]", {
    timeout: 10_000,
  })
}

test.describe("notification center", () => {
  test("opens above an active session stage", async () => {
    const { app, page } = await launchJet()
    try {
      await expectSelectorVisible(page, "[data-yaade-mission-sidebar]")
      await openNewAgentSession(page)
      await expectSelectorVisible(page, "[data-yaade-terminal-modal]", {
        timeout: 20_000,
      })

      await expectLocatorVisible(
        page.locator(
          "[data-yaade-terminal-modal-header] [data-yaade-notification-bell]",
        ),
      )
      await page
        .locator(
          "[data-yaade-terminal-modal-header] [data-yaade-notification-bell]",
        )
        .click()
      await expectSelectorVisible(page, "[data-yaade-notification-center]", {
        timeout: 10_000,
      })
      const centerBox = await page
        .locator("[data-yaade-notification-center]")
        .boundingBox()
      expect(centerBox).toBeTruthy()
      expect(centerBox!.width).toBeGreaterThan(200)
      expect(centerBox!.height).toBeGreaterThan(200)
      // Drawer must dock on the right, not the left (liquid-glass used to win position).
      const viewport = page.viewportSize()
      expect(viewport).toBeTruthy()
      expect(centerBox!.x + centerBox!.width).toBeGreaterThan(viewport!.width - 8)
      expect(centerBox!.x).toBeGreaterThan(viewport!.width / 2)

      // Session stage stays mounted underneath; center must not be covered.
      await expectSelectorVisible(page, "[data-yaade-terminal-modal]")
      await expect
        .poll(async () =>
          page.locator("[data-yaade-notification-center]").evaluate(el => {
            const style = window.getComputedStyle(el)
            return style.visibility !== "hidden" && style.opacity !== "0"
          }),
        )
        .toBe(true)
    } finally {
      await app.close()
    }
  })

  test("ingest creates unread badge, panel, and open-session flow", async () => {
    const { app, page } = await launchJet()
    try {
      await expectSelectorVisible(page, "[data-yaade-mission-sidebar]")
      await expectSelectorVisible(page, "[data-yaade-notification-bell]")

      await openNewAgentSession(page)
      await expectSelectorVisible(page, "[data-yaade-terminal-modal]", {
        timeout: 20_000,
      })
      await closeOverlays(page)
      await expectLocatorCount(page.locator("[data-yaade-terminal-modal]"), 0, {
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

      const state = await page.evaluate(() => window.__yaadeAgent!.getState())
      const projectName = state.workspaces[0]?.name ?? "sample-workspace"
      const projectId = state.workspaces[0]?.id ?? state.workspaces[0]?.path ?? null

      await page.evaluate(
        async ({ sessionId: sid, projectId: pid, projectName: pname }) => {
          const result = await window.__yaadeAgent!.ingestNotification!({
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
            window.__yaadeAgent!.getNotificationCounts!(),
          )
          return counts.totalUnread
        }, { timeout: 15_000 })
        .toBeGreaterThan(0)

      await expectLocatorVisible(page.locator("[data-yaade-notification-badge]"))

      await openCenter(page)
      await expectLocatorContainsText(
        page.locator("[data-yaade-notification-item]").first(),
        "Claude completed the turn",
      )
      await expectLocatorContainsText(
        page.locator("[data-yaade-notification-item]").first(),
        projectName,
      )

      await page.locator("[data-yaade-notification-item] button").first().click()
      await expectSelectorVisible(page, "[data-yaade-terminal-modal]", {
        timeout: 10_000,
      })

      await closeOverlays(page)
      await openCenter(page)
      // Unread-only list: opening marks read → item leaves the center.
      await expectSelectorVisible(page, "[data-yaade-notification-empty]", {
        timeout: 10_000,
      })
      await expect
        .poll(async () => {
          const counts = await page.evaluate(() =>
            window.__yaadeAgent!.getNotificationCounts!(),
          )
          return counts.totalUnread
        }, { timeout: 10_000 })
        .toBe(0)
    } finally {
      await app.close()
    }
  })

  test("permission resolve + mark-all-read clears unread list", async () => {
    const { app, page } = await launchJet()
    try {
      await expectSelectorVisible(page, "[data-yaade-mission-sidebar]")
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
          await window.__yaadeAgent!.ingestNotification!({
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
      await expectLocatorContainsText(
        page.locator("[data-yaade-notification-item]").first(),
        "permission",
      )

      await page.evaluate(
        async ({ sid, eventId: eid }) => {
          await window.__yaadeAgent!.ingestNotification!({
            source: "provider-hook",
            type: "permission-required",
            title: "Permission answered",
            sessionId: sid,
            resolveOf: { type: "permission-required", eventId: eid },
          })
          await window.__yaadeAgent!.ingestNotification!({
            source: "provider-hook",
            type: "turn-completed",
            title: "Claude completed the turn",
            sessionId: sid,
            eventId: `turn-e2e-${Date.now()}`,
          })
        },
        { sid: sessionId, eventId },
      )

      await expectLocatorContainsText(
        page.locator("[data-yaade-notification-item]"),
        "completed",
      )

      await page.locator("[data-yaade-notification-mark-all-read]").click()
      await expectSelectorVisible(page, "[data-yaade-notification-empty]")
      await expect
        .poll(async () => {
          const counts = await page.evaluate(() =>
            window.__yaadeAgent!.getNotificationCounts!(),
          )
          return counts.totalUnread
        }, { timeout: 10_000 })
        .toBe(0)
    } finally {
      await app.close()
    }
  })

  test("hook + osc dedupe; refresh keeps counts", async () => {
    const { app, page } = await launchJet()
    try {
      await expectSelectorVisible(page, "[data-yaade-mission-sidebar]")
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
      const hookStatus = await page.evaluate(
        async ({ sid, turnId: tid }) => {
          await window.__yaadeAgent!.ingestNotification!({
            source: "osc",
            type: "turn-completed",
            title: "Turn complete",
            sessionId: sid,
            provider: "codex",
            providerTurnId: tid,
            eventId: tid,
          })
          const url = new URL("/api/v1/notifications/ingest", window.location.origin)
          url.searchParams.set("provider", "codex")
          url.searchParams.set("sessionId", sid!)
          const response = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              type: "agent-turn-complete",
              "turn-id": tid,
              eventId: tid,
              "last-assistant-message": "Codex completed the turn",
            }),
          })
          return response.status
        },
        { sid: sessionId, turnId },
      )
      expect(hookStatus).toBe(204)

      await openCenter(page)
      await expect
        .poll(async () => page.locator("[data-yaade-notification-item]").count())
        .toBe(1)
      await expectLocatorContainsText(
        page.locator("[data-yaade-notification-item]"),
        "Codex completed",
      )

      const unreadBefore = await page.evaluate(() =>
        window.__yaadeAgent!.getNotificationCounts!(),
      )

      await page.reload()
      await page.waitForFunction(() => window.__yaadeAgent != null, null, {
        timeout: 30_000,
      })
      await page.evaluate(() => window.__yaadeAgent!.waitForReady())
      await expect
        .poll(async () => {
          const counts = await page.evaluate(() =>
            window.__yaadeAgent!.getNotificationCounts!(),
          )
          return counts.totalUnread
        }, { timeout: 15_000 })
        .toBe(unreadBefore.totalUnread)
    } finally {
      await app.close()
    }
  })

  test("two-finger horizontal scroll dismisses row", async () => {
    const { app, page } = await launchJet()
    try {
      await expectSelectorVisible(page, "[data-yaade-mission-sidebar]")
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

      await page.evaluate(async ({ sid }) => {
        await window.__yaadeAgent!.ingestNotification!({
          source: "provider-hook",
          type: "turn-completed",
          title: "Dismiss via scroll",
          sessionId: sid,
          provider: "claude",
          eventId: `scroll-dismiss-${Date.now()}`,
        })
      }, { sid: sessionId })

      await openCenter(page)
      const item = page.locator("[data-yaade-notification-item]").first()
      await expectLocatorContainsText(item, "Dismiss via scroll")

      // Synthetic trackpad horizontal scroll (two-finger sideways).
      await item.evaluate(el => {
        el.dispatchEvent(
          new WheelEvent("wheel", {
            deltaX: 120,
            deltaY: 0,
            bubbles: true,
            cancelable: true,
          }),
        )
      })

      await expectSelectorVisible(page, "[data-yaade-notification-empty]", {
        timeout: 10_000,
      })
    } finally {
      await app.close()
    }
  })
})
