import { expect, test } from "@playwright/test"
import {
  expectLocatorContainsText,
  expectLocatorCount,
  expectSelectorVisible,
} from "../shell/assert.js"
import { launchJet, openNewCliSession } from "./_launch.js"

test.describe("terminal-first session workspace", () => {
  test("gives the agent terminal the full session stage without an activity rail", async () => {
    const { app, page } = await launchJet()
    try {
      await openNewCliSession(page, "codex")

      await expectLocatorContainsText(
        page.locator("[data-gharargah-terminal-modal-title]"),
        "sample-workspace",
      )
      await expectLocatorContainsText(
        page.locator("[data-gharargah-terminal-modal-title]"),
        "Codex",
      )
      await expectLocatorCount(
        page.locator("[data-gharargah-session-mode-label]"),
        4,
      )
      await expectLocatorCount(
        page.locator("[data-gharargah-agent-activity-rail]"),
        0,
      )
      await expectLocatorCount(
        page.locator("[data-gharargah-agent-activity-timeline]"),
        0,
      )
      await expectSelectorVisible(
        page,
        "[data-gharargah-session-pane='agent'] [data-gharargah-terminal-panel]",
      )

      const layout = await page.evaluate(() => {
        const body = document.querySelector(
          "[data-gharargah-terminal-modal-body]",
        )?.getBoundingClientRect()
        const pane = document.querySelector(
          "[data-gharargah-session-pane='agent'][data-active]",
        )?.getBoundingClientRect()
        const terminal = document.querySelector(
          "[data-gharargah-session-pane='agent'][data-active] [data-gharargah-terminal-panel]",
        )?.getBoundingClientRect()
        return body && pane && terminal
          ? {
              body: {
                top: body.top,
                right: body.right,
                bottom: body.bottom,
                left: body.left,
              },
              pane: {
                top: pane.top,
                right: pane.right,
                bottom: pane.bottom,
                left: pane.left,
              },
              terminal: {
                top: terminal.top,
                right: terminal.right,
                bottom: terminal.bottom,
                left: terminal.left,
              },
            }
          : null
      })

      expect(layout).not.toBeNull()
      expect(layout?.pane).toEqual(layout?.body)
      expect(layout?.terminal).toEqual(layout?.body)
    } finally {
      await app.close()
    }
  })
})
