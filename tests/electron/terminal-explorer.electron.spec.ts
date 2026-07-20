import { expect, test } from "@playwright/test"
import {
  expectContainsText,
  expectLocatorAttached,
  expectLocatorAttribute,
  expectLocatorCount,
  expectLocatorFocused,
  expectLocatorHidden,
  expectLocatorVisible,
  expectSelectorHidden,
  expectSelectorVisible,
  expectLocatorContainsText,
  expectNotContainsText,
} from "../shell/assert.js"

import { hasPtySpawn, launchJet, showTerminal, execCommand } from "./_launch.js"
import { expectListRows } from "../helpers/list.js"

const ptyAvailable = hasPtySpawn()

test.describe("electron terminal explorer", () => {
  test.skip(!ptyAvailable, "node-pty cannot spawn a shell on this machine")

  test("terminal.new and terminal.explorer.show list sessions", async () => {
    const { app, page } = await launchJet()
    try {
      await showTerminal(page)
      await execCommand(page, "terminal.new")
      await page.waitForTimeout(500)
      await execCommand(page, "terminal.explorer.show")
      await expectSelectorVisible(page, "[data-gharargah-list-panel='gharargah:terminal-explorer']")
    } finally {
      await app.close()
    }
  })

  test("terminal.show toggles terminal visibility", async () => {
    const { app, page } = await launchJet()
    try {
      await showTerminal(page)
      await expectSelectorVisible(page, "[data-gharargah-terminal-panel]")
      await execCommand(page, "terminal.show")
      await page.waitForTimeout(400)
    } finally {
      await app.close()
    }
  })

  test("terminal list labels and switches sessions without the sidebar", async () => {
    const { app, page } = await launchJet()
    try {
      const workspaceName = await page.evaluate(() => window.__gharargahAgent!.listWorkspaces()[0]?.name ?? "")
      await execCommand(page, "terminal.new")
      await execCommand(page, "terminal.new")
      await execCommand(page, "terminal.list")

      await expectListRows(page, {
        panel: "gharargah:palette",
        minItems: 1,
        needle: `${workspaceName}:`,
        noResultsText: "No open terminals",
      })
      await page.getByRole("option").first().click()
      await expectLocatorHidden(page.getByRole("dialog"))
      await expectSelectorHidden(page, "[data-gharargah-workspace-sidebar]")
    } finally {
      await app.close()
    }
  })

  test("agent launcher selection does not collapse its project", async () => {
    const { app, page } = await launchJet()
    try {
      await execCommand(page, "terminal.explorer.show")
      const explorer = page.locator("[data-gharargah-list-panel='gharargah:terminal-explorer']")
      const projectRow = explorer.locator("[role='treeitem'][aria-level='1']").first()
      await expectLocatorAttribute(projectRow, "aria-expanded", "true")

      await projectRow.getByRole("button", { name: "Launch agent" }).click()
      await page.getByRole("menuitem", { name: "Codex" }).click()

      await expectLocatorAttribute(projectRow, "aria-expanded", "true")
    } finally {
      await app.close()
    }
  })

  test("project and terminal context menus expose scoped actions", async () => {
    const { app, page } = await launchJet()
    try {
      await execCommand(page, "terminal.explorer.show")
      const explorer = page.locator("[data-gharargah-list-panel='gharargah:terminal-explorer']")
      const projectRow = explorer.locator("[role='treeitem'][aria-level='1']").first()
      await projectRow.click({ button: "right" })
      await expectLocatorVisible(page.getByRole("menuitem", { name: "Activate Project" }))
      await expectLocatorVisible(page.getByRole("menuitem", { name: "New Terminal" }))
      await expectLocatorVisible(page.getByRole("menuitem", { name: "Launch Agent" }))
      await expectLocatorVisible(page.getByRole("menuitem", { name: "Copy Project Path" }))
      await expectLocatorVisible(page.getByRole("menuitem", { name: "Remove Project" }))
      await page.keyboard.press("Escape")

      await projectRow.getByRole("button", { name: "New terminal" }).click()
      const terminalRow = explorer.locator("[role='treeitem'][aria-level='2']").first()
      await expectLocatorVisible(terminalRow)
      await terminalRow.click({ button: "right" })
      await expectLocatorVisible(page.getByRole("menuitem", { name: "Focus" }))
      await expectLocatorVisible(page.getByRole("menuitem", { name: "Rename…" }))
      await expectLocatorVisible(page.getByRole("menuitem", { name: "Duplicate" }))
      await expectLocatorVisible(page.getByRole("menuitem", { name: "Copy Working Directory" }))
      await page.getByRole("menuitem", { name: "Rename…" }).click()

      const rename = explorer.getByRole("textbox", { name: /Rename/ })
      await rename.fill("Build agent")
      await rename.press("Enter")
      await expectLocatorContainsText(terminalRow, "Build agent")
    } finally {
      await app.close()
    }
  })
})
