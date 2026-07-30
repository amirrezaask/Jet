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

      const pickerInput = page.getByRole("combobox", { name: "Choose agent" })
      await expect
        .poll(() => pickerInput.getAttribute("aria-controls"))
        .not.toBeNull()
      await expect
        .poll(() => pickerInput.getAttribute("aria-activedescendant"))
        .not.toBeNull()
      await page.keyboard.press("Enter")
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
      await expectSelectorVisible(
        page,
        '[data-gharargah-palette][data-gharargah-palette-fit="content"]',
      )
      const quickOpenInput = page.locator('[role="dialog"][data-state="open"] input').first()
      await quickOpenInput.waitFor({ state: "visible", timeout: 10_000 })
      await quickOpenInput.fill("index")
      await expectListRows(page, {
        panel: "gharargah:palette",
        minItems: 1,
        needle: "index",
        noResultsText: "No matching files.",
      })
      // Dialog reports fit-content sizing; width must cover longest visible path label.
      await expect
        .poll(async () =>
          page.evaluate(() => {
            const dialog = document.querySelector<HTMLElement>(
              '[data-gharargah-palette][data-gharargah-palette-fit="content"]',
            )
            if (!dialog) return null
            const rows = [
              ...document.querySelectorAll<HTMLElement>(
                '[data-gharargah-list-panel="gharargah:palette"] [data-gharargah-list-item] .font-mono',
              ),
            ]
            if (rows.length === 0) return null
            const truncated = rows.some(el => el.scrollWidth > el.clientWidth + 1)
            return {
              dialogWidth: dialog.getBoundingClientRect().width,
              truncated,
            }
          }),
        )
        .toMatchObject({ truncated: false })
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
