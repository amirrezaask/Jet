import { expect, test } from "@playwright/test"
import {
  expectLocatorVisible,
  expectSelectorVisible,
  expectLocatorContainsText,
  expectLocatorCount,
} from "../shell/assert.js"
import { hasPtySpawn, launchJet, execCommand } from "./_launch.js"
import { expectListRows } from "../helpers/list.js"

const ptyAvailable = hasPtySpawn()

test.describe("gharargah mission home", () => {
  test.skip(!ptyAvailable, "node-pty cannot spawn a shell on this machine")

  test("home greeting, project section, search, card opens terminal modal, home returns", async () => {
    const { app, page } = await launchJet()
    try {
      await expectSelectorVisible(page, "[data-gharargah-home]")
      await expectSelectorVisible(page, "[data-gharargah-shell='home']")
      await expect
        .poll(async () => {
          return page.locator("[data-gharargah-home] > div").evaluate(el => {
            const width = el.getBoundingClientRect().width
            return width / window.innerWidth
          })
        })
        .toBeGreaterThan(0.95)
      await expectLocatorContainsText(page.locator("[data-gharargah-home]"), /Good (morning|afternoon|evening)/)

      const state = await page.evaluate(() => window.__gharargahAgent!.getState())
      expect(state.shellView).toBe("home")
      const workspaceName = state.workspaces[0]?.name ?? "sample-workspace"
      const sectionSel = `[data-gharargah-project-section][data-gharargah-project-name="${workspaceName}"]`

      const section = page.locator(sectionSel)
      await expectLocatorVisible(section)

      await section.getByRole("button", { name: "New session" }).click()
      const sessionMenu = page.locator('[data-slot="dropdown-menu-content"]')
      await expectLocatorVisible(sessionMenu)
      await expectLocatorVisible(sessionMenu.getByRole("menuitem", { name: "Terminal" }))
      await expectLocatorVisible(sessionMenu.getByRole("menuitem", { name: "Codex" }))
      await expectLocatorVisible(sessionMenu.getByRole("menuitem", { name: "Claude" }))
      await expectLocatorVisible(sessionMenu.getByRole("menuitem", { name: "Cursor Agent" }))
      await sessionMenu.locator('[data-slot="dropdown-menu-item"]', { hasText: "Terminal" }).click()
      await expect
        .poll(async () => page.evaluate(() => window.__gharargahAgent?.getState()?.shellView ?? null), {
          timeout: 20_000,
        })
        .toBe("home")
      await expectSelectorVisible(page, "[data-gharargah-terminal-modal]", { timeout: 20_000 })
      await expectSelectorVisible(page, "[data-gharargah-terminal-panel]", { timeout: 20_000 })
      await expectSelectorVisible(page, "[data-gharargah-home]")
      const afterNew = await page.evaluate(() => window.__gharargahAgent!.getState())
      expect(afterNew.activeWorkspace).toBeTruthy()

      await page.keyboard.press("Escape")
      await expectLocatorCount(page.locator("[data-gharargah-terminal-modal]"), 0)
      await expectSelectorVisible(page, "[data-gharargah-home]")

      const cards = section.locator("[data-gharargah-terminal-card]")
      await expectLocatorVisible(cards.first())
      await expect
        .poll(async () => (await cards.first().textContent())?.trim().length ?? 0, { timeout: 10_000 })
        .toBeGreaterThan(0)

      const search = page.locator("[data-gharargah-home-search]")
      await search.fill("___no_such_project___")
      await expectLocatorCount(page.locator(sectionSel), 0)
      await search.fill(workspaceName.slice(0, Math.min(6, workspaceName.length)))
      await expectLocatorVisible(section)
      await expectLocatorVisible(cards.first())

      await cards.first().click()
      await expect
        .poll(async () => page.evaluate(() => window.__gharargahAgent?.getState()?.shellView ?? null), {
          timeout: 20_000,
        })
        .toBe("home")
      await expectSelectorVisible(page, "[data-gharargah-terminal-modal]")
      await expectSelectorVisible(page, "[data-gharargah-terminal-panel]")

      await execCommand(page, "gharargah.goHome")
      await expectLocatorCount(page.locator("[data-gharargah-terminal-modal]"), 0)
      await expectSelectorVisible(page, "[data-gharargah-home]")
      const afterHome = await page.evaluate(() => window.__gharargahAgent!.getState())
      expect(afterHome.shellView).toBe("home")
    } finally {
      await app.close()
    }
  })

  test("project and terminal card context menus, modal close, git branch, Cmd+p terminal list", async () => {
    const { app, page } = await launchJet()
    try {
      await expectSelectorVisible(page, "[data-gharargah-home]")
      const workspaceName = await page.evaluate(
        () => window.__gharargahAgent!.listWorkspaces()[0]?.name ?? "sample-workspace",
      )
      const section = page.locator(
        `[data-gharargah-project-section][data-gharargah-project-name="${workspaceName}"]`,
      )
      await expectLocatorVisible(section)

      await section.locator("[data-gharargah-project-row]").click({ button: "right" })
      const projectMenu = page.locator("[data-gharargah-project-menu]")
      await expectLocatorVisible(projectMenu)
      await expectLocatorVisible(projectMenu.getByRole("menuitem", { name: "Remove Project" }))
      await page.keyboard.press("Escape")
      await expectLocatorCount(projectMenu, 0)

      await section.getByRole("button", { name: "New session" }).click()
      const sessionMenu = page.locator('[data-slot="dropdown-menu-content"]')
      await expectLocatorVisible(sessionMenu)
      await sessionMenu.locator('[data-slot="dropdown-menu-item"]', { hasText: "Terminal" }).click()
      await expectSelectorVisible(page, "[data-gharargah-terminal-modal]", { timeout: 20_000 })
      await expectSelectorVisible(page, "[data-gharargah-terminal-modal-close]")
      await expect
        .poll(async () => {
          return page.locator("[data-gharargah-terminal-modal]").evaluate(el => {
            const rect = el.getBoundingClientRect()
            const fullW = Math.abs(rect.width - window.innerWidth) < 2
            const fullH = Math.abs(rect.height - window.innerHeight) < 2
            return fullW && fullH
          })
        }, { timeout: 10_000 })
        .toBe(true)
      await expectSelectorVisible(page, "[data-gharargah-terminal-modal-sessions]")
      await expectListRows(page, {
        panel: "gharargah:terminal-modal-sessions",
        minItems: 1,
        needle: "Terminal",
        noResultsText: "No sessions",
      })
      await expect
        .poll(async () => page.locator("[data-gharargah-terminal-git-branch]").textContent(), {
          timeout: 15_000,
        })
        .toMatch(/main/)

      await page.locator("[data-gharargah-terminal-modal-close]").click()
      await expectLocatorCount(page.locator("[data-gharargah-terminal-modal]"), 0)

      const cards = section.locator("[data-gharargah-terminal-card]:not([data-gharargah-new-session])")
      await expectLocatorVisible(cards.first())
      await cards.first().click({ button: "right" })
      const cardMenu = page.locator("[data-gharargah-terminal-card-menu]")
      await expectLocatorVisible(cardMenu)
      await cardMenu.getByRole("menuitem", { name: "Kill Terminal" }).click()
      await expect
        .poll(async () => cards.count(), { timeout: 10_000 })
        .toBe(0)
      await expectLocatorVisible(section.locator("[data-gharargah-new-session]"))

      await execCommand(page, "terminal.new")
      await expectSelectorVisible(page, "[data-gharargah-terminal-modal]", { timeout: 20_000 })
      await page.keyboard.press("Escape")
      await expectLocatorCount(page.locator("[data-gharargah-terminal-modal]"), 0)

      await page.keyboard.press("Meta+p")
      await expectListRows(page, {
        panel: "gharargah:palette",
        minItems: 1,
        needle: `${workspaceName}:`,
        noResultsText: "No open terminals",
      })
    } finally {
      await app.close()
    }
  })

  test("home has no custom titlebar chrome", async () => {
    const { app, page } = await launchJet()
    try {
      await expectSelectorVisible(page, "[data-gharargah-home]")
      await expectLocatorCount(page.locator("[data-gharargah-titlebar]"), 0)
      await expectLocatorCount(page.locator("[data-gharargah-home-button]"), 0)
      await expectLocatorCount(page.locator("[data-gharargah-status-zone]"), 0)
    } finally {
      await app.close()
    }
  })
})
