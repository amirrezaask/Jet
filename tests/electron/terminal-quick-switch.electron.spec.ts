import { expect, test } from "@playwright/test"
import { expectLocatorContainsText, expectSelectorVisible } from "../shell/assert.js"
import { hasPtySpawn, launchJet, showTerminal, execCommand } from "./_launch.js"
import { resolve } from "node:path"

const ptyAvailable = hasPtySpawn()
const isMac = process.platform === "darwin"
const SECOND = resolve(__dirname, "..", "..", "fixtures/second-workspace")

test.describe("mac terminal quick switch", () => {
  test.skip(!ptyAvailable || !isMac, "macOS terminal quick-switch bindings only")

  test("Cmd+2 focuses the second terminal in the active workspace", async () => {
    const { app, page } = await launchJet()
    try {
      await showTerminal(page)
      await execCommand(page, "terminal.new")
      await execCommand(page, "terminal.new")
      await page.waitForTimeout(400)

      await page.keyboard.press("Meta+2")
      await page.waitForTimeout(300)

      const activeTab = page.locator("[data-gharargah-tab-slot][data-gharargah-tab-active]")
      await expectSelectorVisible(page, "[data-gharargah-terminal-panel]")
      await expectLocatorContainsText(activeTab, "Terminal 2")
    } finally {
      await app.close()
    }
  })

  test("Ctrl+2 switches workspace and focuses its first terminal", async () => {
    const { app, page } = await launchJet()
    try {
      await page.evaluate(async (p: string) => {
        await window.__gharargahAgent!.addWorkspace(p)
      }, SECOND)

      await expect
        .poll(() => page.evaluate(() => window.__gharargahAgent!.listWorkspaces().length))
        .toBe(2)

      const workspaces = await page.evaluate(() => window.__gharargahAgent!.listWorkspaces())
      const secondName = workspaces[1]?.name ?? ""

      await showTerminal(page)
      await execCommand(page, "terminal.new")
      await page.waitForTimeout(400)

      await page.evaluate(async () => {
        await window.__gharargahAgent!.executeCommand("workspace.focusFolder")
      })
      await page.waitForTimeout(400)
      await execCommand(page, "terminal.new")
      await page.waitForTimeout(400)

      await page.keyboard.press("Control+2")
      await page.waitForTimeout(500)

      await expect
        .poll(() => page.evaluate(() => window.__gharargahAgent!.getState().activeWorkspace))
        .toContain(secondName)

      const activeTab = page.locator("[data-gharargah-tab-slot][data-gharargah-tab-active]")
      await expectSelectorVisible(page, "[data-gharargah-terminal-panel]")
      await expectLocatorContainsText(activeTab, "Terminal")
    } finally {
      await app.close()
    }
  })
})
