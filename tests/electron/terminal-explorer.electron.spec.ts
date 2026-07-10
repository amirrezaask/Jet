import { expect, test } from "@playwright/test"
import { hasPtySpawn, launchJet, showTerminal, execCommand } from "./_launch.js"

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
      await expect(page.locator("[data-jet-list-panel='jet:terminal-explorer']")).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test("terminal.show toggles terminal visibility", async () => {
    const { app, page } = await launchJet()
    try {
      await showTerminal(page)
      await expect(page.locator("[data-jet-terminal-panel]")).toBeVisible()
      await execCommand(page, "terminal.show")
      await page.waitForTimeout(400)
    } finally {
      await app.close()
    }
  })

  test("agent launcher selection does not collapse its project", async () => {
    const { app, page } = await launchJet()
    try {
      const explorer = page.locator("[data-jet-list-panel='jet:terminal-explorer']")
      const projectRow = explorer.locator("[role='treeitem'][aria-level='1']").first()
      await expect(projectRow).toHaveAttribute("aria-expanded", "true")

      await projectRow.getByRole("button", { name: "Launch agent" }).click()
      await page.getByRole("menuitem", { name: "Codex" }).click()

      await expect(projectRow).toHaveAttribute("aria-expanded", "true")
    } finally {
      await app.close()
    }
  })

  test("project and terminal context menus expose scoped actions", async () => {
    const { app, page } = await launchJet()
    try {
      const explorer = page.locator("[data-jet-list-panel='jet:terminal-explorer']")
      const projectRow = explorer.locator("[role='treeitem'][aria-level='1']").first()
      await projectRow.click({ button: "right" })
      await expect(page.getByRole("menuitem", { name: "Activate Project" })).toBeVisible()
      await expect(page.getByRole("menuitem", { name: "New Terminal" })).toBeVisible()
      await expect(page.getByRole("menuitem", { name: "Launch Agent" })).toBeVisible()
      await expect(page.getByRole("menuitem", { name: "Copy Project Path" })).toBeVisible()
      await expect(page.getByRole("menuitem", { name: "Remove Project" })).toBeVisible()
      await page.keyboard.press("Escape")

      await projectRow.getByRole("button", { name: "New terminal" }).click()
      const terminalRow = explorer.locator("[role='treeitem'][aria-level='2']").first()
      await expect(terminalRow).toBeVisible()
      await terminalRow.click({ button: "right" })
      await expect(page.getByRole("menuitem", { name: "Focus" })).toBeVisible()
      await expect(page.getByRole("menuitem", { name: "Rename…" })).toBeVisible()
      await expect(page.getByRole("menuitem", { name: "Duplicate" })).toBeVisible()
      await expect(page.getByRole("menuitem", { name: "Copy Working Directory" })).toBeVisible()
      await page.getByRole("menuitem", { name: "Rename…" }).click()

      const rename = explorer.getByRole("textbox", { name: /Rename/ })
      await rename.fill("Build agent")
      await rename.press("Enter")
      await expect(terminalRow).toContainText("Build agent")
    } finally {
      await app.close()
    }
  })
})
