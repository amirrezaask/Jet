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

test.describe.skip("keyboard shortcuts revamp", () => {
  test.skip(!ptyAvailable, "PTY support required for session shortcuts")

  test("Mod-n opens agent picker; Mod-k switches sessions", async () => {
    const { app, page } = await launchJet()
    try {
      await waitForHome(page)

      await pressMod(page, "n")
      await expectSelectorVisible(page, "[data-yaade-agent-cli-option]", {
        timeout: 15_000,
      })
      await expect
        .poll(async () =>
          page.locator("[data-yaade-agent-cli-option]").count(),
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
      await expectSelectorVisible(page, "[data-yaade-terminal-modal]", {
        timeout: 20_000,
      })
      await execCommand(page, "yaade.goHome")
      await expectLocatorCount(page.locator("[data-yaade-terminal-modal]"), 0)

      await pressMod(page, "k")
      await expectListRows(page, {
        panel: "yaade:palette",
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
      await expectSelectorVisible(page, "[data-yaade-terminal-modal]")

      await pressMod(page, "p")
      await expectSelectorVisible(page, '[data-yaade-list-panel="yaade:palette"]', {
        timeout: 20_000,
      })
      await expectSelectorVisible(
        page,
        '[data-yaade-palette][data-yaade-palette-fit="content"]',
      )
      const quickOpenInput = page.locator('[role="dialog"][data-state="open"] input').first()
      await quickOpenInput.waitFor({ state: "visible", timeout: 10_000 })
      await quickOpenInput.fill("index")
      await expectListRows(page, {
        panel: "yaade:palette",
        minItems: 1,
        needle: "index",
        noResultsText: "No matching files.",
      })
      // Dialog reports fit-content sizing; width must cover longest visible path label.
      await expect
        .poll(async () =>
          page.evaluate(() => {
            const dialog = document.querySelector<HTMLElement>(
              '[data-yaade-palette][data-yaade-palette-fit="content"]',
            )
            if (!dialog) return null
            const rows = [
              ...document.querySelectorAll<HTMLElement>(
                '[data-yaade-list-panel="yaade:palette"] [data-yaade-list-item] .font-mono',
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
        page.locator('[data-yaade-list-panel="yaade:palette"]'),
        0,
      )

      await pressMod(page, "g", { shift: true })
      await expect
        .poll(
          async () =>
            page.evaluate(
              () => window.__yaadeAgent?.getState()?.sessionMode ?? null,
            ),
          { timeout: 15_000 },
        )
        .toBe("git")
      await expectSelectorVisible(page, "[data-yaade-git-workspace]", {
        timeout: 20_000,
      })
      await expectSelectorVisible(
        page,
        '[data-yaade-session-mode-tab="git"][data-active]',
      )
    } finally {
      await app.close()
    }
  })

  test("Mod-b toggles sidebar collapse", async () => {
    const { app, page } = await launchJet()
    try {
      await waitForHome(page)
      await expectSelectorVisible(page, "[data-yaade-mission-sidebar]")
      await expect
        .poll(async () =>
          page
            .locator("[data-yaade-mission-sidebar]")
            .getAttribute("data-yaade-sidebar-state"),
        )
        .toBe("expanded")

      await pressMod(page, "b")
      await expect
        .poll(async () =>
          page
            .locator("[data-yaade-mission-sidebar]")
            .getAttribute("data-yaade-sidebar-state"),
        )
        .toBe("collapsed")

      await pressMod(page, "b")
      await expect
        .poll(async () =>
          page
            .locator("[data-yaade-mission-sidebar]")
            .getAttribute("data-yaade-sidebar-state"),
        )
        .toBe("expanded")
    } finally {
      await app.close()
    }
  })
})
