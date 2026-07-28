import { expect, test } from "@playwright/test"
import {
  expectLocatorCount,
  expectLocatorVisible,
  expectSelectorVisible,
} from "../shell/assert.js"
import {
  clickNewSession,
  hasPtySpawn,
  launchJet,
  pickAgentCli,
  REPO_ROOT,
} from "./_launch.js"
import { resolve } from "node:path"

const ptyAvailable = hasPtySpawn()

test.describe("new session project picker", () => {
  test.skip(!ptyAvailable, "PTY sessions are unavailable on this machine")

  test("shows project chips when multiple workspaces exist", async () => {
    const secondPath = resolve(REPO_ROOT, "fixtures/second-workspace")
    const { app, page } = await launchJet()
    try {
      await expect
        .poll(() =>
          page.evaluate(
            () => window.__gharargahAgent!.getState().sessionLayout,
          ),
        )
        .toBe("cards")

      await page.evaluate(
        path => window.__gharargahAgent!.addWorkspace(path),
        secondPath,
      )
      await expect
        .poll(() =>
          page.evaluate(() => window.__gharargahAgent!.listWorkspaces().length),
        )
        .toBeGreaterThanOrEqual(2)

      await clickNewSession(page)
      await expectSelectorVisible(page, "[data-gharargah-palette]")
      await expectSelectorVisible(
        page,
        "[data-gharargah-agent-cli-project-picker]",
      )

      const chips = page.locator("[data-gharargah-agent-cli-project-option]")
      await expectLocatorCount(chips, 2)

      const secondChip = page
        .locator("[data-gharargah-agent-cli-project-option]")
        .filter({ hasText: "second-workspace" })
        .first()
      await expectLocatorVisible(secondChip)
      await secondChip.click()
      await expect
        .poll(() => secondChip.getAttribute("data-state"))
        .toBe("on")

      await pickAgentCli(page, "codex")
      await expectSelectorVisible(
        page,
        '[data-gharargah-terminal-modal][data-gharargah-session-presentation="modal"]',
        { timeout: 20_000 },
      )
    } finally {
      await app.close()
    }
  })

  test("hides project chips for a single workspace", async () => {
    const { app, page } = await launchJet()
    try {
      await expect
        .poll(() =>
          page.evaluate(() => window.__gharargahAgent!.listWorkspaces().length),
        )
        .toBe(1)

      await clickNewSession(page)
      await expectSelectorVisible(page, "[data-gharargah-palette]")
      await expectLocatorCount(
        page.locator("[data-gharargah-agent-cli-project-picker]"),
        0,
      )
      await pickAgentCli(page, "codex")
      await expectSelectorVisible(
        page,
        "[data-gharargah-terminal-modal]",
        { timeout: 20_000 },
      )
    } finally {
      await app.close()
    }
  })
})
