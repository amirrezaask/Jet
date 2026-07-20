import { expect, test } from "@playwright/test"
import { expectSelectorVisible } from "../shell/assert.js"
import { hasPtySpawn, launchJet, showTerminal, execCommand } from "./_launch.js"
import { resolve } from "node:path"

const ptyAvailable = hasPtySpawn()
const isMac = process.platform === "darwin"
const SECOND = resolve(__dirname, "..", "..", "fixtures/second-workspace")

async function modalTitle(page: { evaluate: (fn: () => string | null) => Promise<string | null> }): Promise<string> {
  return (
    (await page.evaluate(() => {
      return (
        document.querySelector("[data-gharargah-terminal-modal] [data-slot='dialog-title']")?.textContent ??
        document.querySelector("[data-gharargah-terminal-modal]")?.textContent?.slice(0, 80) ??
        null
      )
    })) ?? ""
  )
}

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

      await expectSelectorVisible(page, "[data-gharargah-terminal-modal]")
      await expectSelectorVisible(page, "[data-gharargah-terminal-panel]")
      // Shell OSC titles often replace "Terminal 2" (e.g. "zsh 2"); still must be the 2nd session.
      await expect
        .poll(async () => modalTitle(page), { timeout: 10_000 })
        .toMatch(/2/)
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

      await expectSelectorVisible(page, "[data-gharargah-terminal-modal]")
      await expectSelectorVisible(page, "[data-gharargah-terminal-panel]")
      await expect
        .poll(async () => modalTitle(page), { timeout: 10_000 })
        .toContain(secondName)
    } finally {
      await app.close()
    }
  })
})
