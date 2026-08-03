import { expect, test } from "@playwright/test"
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  expectLocatorContainsText,
  expectLocatorVisible,
  expectNotContainsText,
  expectSelectorVisible,
} from "../shell/assert.js"
import { expectListRows } from "../helpers/list.js"
import {
  clickNewSession,
  hasPtySpawn,
  launchJet,
  waitForHome,
} from "./_launch.js"

const ptyAvailable = hasPtySpawn()
const EXTERNAL_SESSION_ID = "ses_external_history"
const EXTERNAL_SESSION_COUNT = 30

test.describe("provider CLI session history", () => {
  test.skip(!ptyAvailable, "PTY support required to resume a provider session")

  test("opens history on hover and keyboard highlight, then resumes into the roster", async () => {
    const fakeBin = await mkdtemp(join(tmpdir(), "yaade-cli-history-"))
    const opencode = join(fakeBin, "opencode")
    const historyJson = JSON.stringify(
      Array.from({ length: EXTERNAL_SESSION_COUNT }, (_, index) => ({
        id:
          index === 0
            ? EXTERNAL_SESSION_ID
            : `${EXTERNAL_SESSION_ID}_${String(index + 1).padStart(2, "0")}`,
        title:
          index === 0
            ? "External OpenCode session"
            : `External OpenCode session ${String(index + 1).padStart(2, "0")}`,
        updated: 1785595545000 - index * 60_000,
        created: 1785593166000 - index * 60_000,
        directory: fakeBin,
      })),
    )
    await writeFile(
      opencode,
      `#!/bin/sh
if [ "$1" = "session" ] && [ "$2" = "list" ]; then
  sleep 0.2
  cat <<'JSON'
${historyJson}
JSON
  exit 0
fi
printf 'resumed %s\n' "$*"
sleep 1
`,
      "utf8",
    )
    await chmod(opencode, 0o755)

    const { app, page } = await launchJet({
      env: { PATH: `${fakeBin}:${process.env.PATH ?? ""}` },
    })
    try {
      await waitForHome(page)
      // Startup prefetch warms provider history in the background. Give the fake
      // OpenCode list (~200ms) a beat so highlight can hit the shared cache.
      await expect
        .poll(
          async () =>
            page.evaluate(() =>
              performance
                .getEntriesByName("yaade:agent-cli-history-prefetch")
                .some(entry => entry.entryType === "measure"),
            ),
          { timeout: 20_000, intervals: [100, 250, 500] },
        )
        .toBe(true)

      await clickNewSession(page)

      const openCodeRow = page
        .getByRole("option")
        .filter({ hasText: "OpenCode" })
      await openCodeRow.hover()

      const history = page.locator(
        '[data-yaade-agent-cli-history][data-provider="opencode"]',
      )
      await expectLocatorVisible(history)
      await expect
        .poll(() => history.getAttribute("data-yaade-agent-cli-history-state"))
        .toBe("loaded")
      await expectLocatorContainsText(history, "External OpenCode session")
      await expectNotContainsText(
        page,
        '[data-yaade-agent-cli-history][data-provider="opencode"]',
        "No previous sessions found",
      )
      await expectListRows(page, {
        panel: "agent-cli-history",
        minItems: 2,
        minRowHeight: 60,
        needle: "External OpenCode session",
        noResultsText: "No previous sessions found",
      })

      const historyList = history.locator(
        '[data-yaade-list-panel="agent-cli-history"]',
      )
      const initialRenderedRows = await historyList
        .locator("[data-yaade-list-item]")
        .count()
      expect(initialRenderedRows).toBeLessThan(EXTERNAL_SESSION_COUNT)
      const scrollMetrics = await historyList.evaluate(element => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      }))
      expect(scrollMetrics.scrollHeight).toBeGreaterThan(
        scrollMetrics.clientHeight,
      )

      await historyList.evaluate(element => {
        element.scrollTop = element.scrollHeight
      })
      await expectLocatorContainsText(history, "External OpenCode session 30")
      await historyList.evaluate(element => {
        element.scrollTop = 0
      })
      await expectLocatorContainsText(history, "External OpenCode session")

      const search = page.getByRole("combobox", { name: "Choose agent" })
      await search.focus()
      await page.keyboard.press("ArrowUp")
      await expectLocatorContainsText(
        page.locator(
          '[data-yaade-agent-cli-history][data-provider="claude"]',
        ),
        "interactive resume picker",
      )
      await page.keyboard.press("ArrowDown")
      await expectLocatorContainsText(history, "External OpenCode session")

      await history
        .locator(
          `[data-yaade-agent-cli-history-session="${EXTERNAL_SESSION_ID}"]`,
        )
        .click()
      await expectSelectorVisible(page, "[data-yaade-terminal-modal]")

      await expect
        .poll(() =>
          page.evaluate(async sessionId => {
            const response = await fetch("/api/v1/sessions")
            const roster = await response.json() as {
              sessions: Array<{
                label: string
                agentId?: string
                agentDriverId?: string
                agentCliSessionId?: string
                launchArgs?: string[]
                lastActivityAt?: string
              }>
            }
            return roster.sessions.find(
              session => session.agentCliSessionId === sessionId,
            ) ?? null
          }, EXTERNAL_SESSION_ID),
        )
        .toMatchObject({
          label: "External OpenCode session",
          agentId: "opencode",
          agentDriverId: "opencode:cli",
          agentCliSessionId: EXTERNAL_SESSION_ID,
          launchArgs: ["--session", EXTERNAL_SESSION_ID],
          lastActivityAt: expect.any(String),
        })
    } finally {
      await app.close()
      await rm(fakeBin, { recursive: true, force: true })
    }
  })
})
