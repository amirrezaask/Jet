import { expect, test } from "@playwright/test"
import {
  expectLocatorCount,
  expectSelectorVisible,
} from "../shell/assert.js"
import { expectListRows } from "../helpers/list.js"
import {
  execCommand,
  hasPtySpawn,
  launchJet,
  openNewCliSession,
  pressMod,
  waitForHome,
} from "./_launch.js"

const ptyAvailable = hasPtySpawn()

test.describe("keyboard shortcuts revamp", () => {
  test.skip(!ptyAvailable, "PTY support required for session shortcuts")

  test("Mod-n opens agent picker; Mod-k switches sessions", async () => {
    const { app, page } = await launchJet()
    try {
      await waitForHome(page)

      await pressMod(page, "n")
      await expectSelectorVisible(page, "[data-gharargah-agent-cli-option]", {
        timeout: 15_000,
      })
      await expect
        .poll(async () =>
          page.locator("[data-gharargah-agent-cli-option]").count(),
        )
        .toBeGreaterThan(0)

      await page.keyboard.press("Escape")
      await expectLocatorCount(
        page.locator("[data-gharargah-agent-cli-option]"),
        0,
      )

      await execCommand(page, "terminal.new")
      await expectSelectorVisible(page, "[data-gharargah-terminal-modal]", {
        timeout: 20_000,
      })
      await execCommand(page, "gharargah.goHome")
      await expectLocatorCount(page.locator("[data-gharargah-terminal-modal]"), 0)

      await pressMod(page, "k")
      await expectListRows(page, {
        panel: "gharargah:palette",
        minItems: 1,
        needle: ":",
        noResultsText: "No open terminals",
      })
    } finally {
      await app.close()
    }
  })

  test("Mod-p quick-opens files; Mod-Shift-g opens git in session", async () => {
    const { app, page } = await launchJet()
    try {
      await waitForHome(page)
      await openNewCliSession(page, "codex")
      await expectSelectorVisible(page, "[data-gharargah-terminal-modal]")

      await pressMod(page, "p")
      await expectSelectorVisible(page, '[data-gharargah-list-panel="gharargah:palette"]', {
        timeout: 20_000,
      })
      const quickOpenInput = page.locator('[role="dialog"][data-state="open"] input').first()
      await quickOpenInput.waitFor({ state: "visible", timeout: 10_000 })
      await quickOpenInput.fill("index")
      await expectListRows(page, {
        panel: "gharargah:palette",
        minItems: 1,
        needle: "index",
        noResultsText: "No matching files.",
      })
      await page.keyboard.press("Escape")
      await expectLocatorCount(
        page.locator('[data-gharargah-list-panel="gharargah:palette"]'),
        0,
      )

      await pressMod(page, "g", { shift: true })
      await expect
        .poll(
          async () =>
            page.evaluate(
              () => window.__gharargahAgent?.getState()?.sessionMode ?? null,
            ),
          { timeout: 15_000 },
        )
        .toBe("git")
      await expectSelectorVisible(page, "[data-gharargah-git-workspace]", {
        timeout: 20_000,
      })
      await expectSelectorVisible(
        page,
        '[data-gharargah-session-mode-tab="git"][data-active]',
      )
    } finally {
      await app.close()
    }
  })

  test("Mod-b toggles sidebar collapse", async () => {
    const { app, page } = await launchJet()
    try {
      await waitForHome(page)
      await execCommand(page, "ui.setSessionLayout.sidebar")
      await expectSelectorVisible(page, "[data-gharargah-mission-sidebar]")
      await expect
        .poll(async () =>
          page
            .locator("[data-gharargah-mission-sidebar]")
            .getAttribute("data-gharargah-sidebar-state"),
        )
        .toBe("expanded")

      await pressMod(page, "b")
      await expect
        .poll(async () =>
          page
            .locator("[data-gharargah-mission-sidebar]")
            .getAttribute("data-gharargah-sidebar-state"),
        )
        .toBe("collapsed")

      await pressMod(page, "b")
      await expect
        .poll(async () =>
          page
            .locator("[data-gharargah-mission-sidebar]")
            .getAttribute("data-gharargah-sidebar-state"),
        )
        .toBe("expanded")
    } finally {
      await app.close()
    }
  })
})
