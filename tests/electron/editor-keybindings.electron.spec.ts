import { test } from "@playwright/test"
import {
  expectLocatorCount,
  expectLocatorVisible,
  expectSelectorVisible,
} from "../shell/assert.js"
import { execCommand, launchJet } from "./_launch.js"

test.describe("Monaco app shortcuts", () => {
  test("Mod-p opens one Quick Open and Mod-Shift-p opens the command palette", async () => {
    const { app, page } = await launchJet()
    try {
      await execCommand(page, "terminal.new")
      await expectSelectorVisible(page, "[data-yaade-terminal-modal]", {
        timeout: 20_000,
      })
      await page.locator('[data-yaade-session-mode-tab="editor"]').click()
      await page.evaluate(async () => {
        await window.__yaadeAgent!.openFile("src/index.ts")
        await window.__yaadeAgent!.waitForEditor()
      })
      await expectSelectorVisible(page, "[data-yaade-monaco-editor]", {
        timeout: 20_000,
      })

      await execCommand(page, "workspace.quickOpen")
      await expectLocatorVisible(page.getByPlaceholder("Type a file name…"), {
        timeout: 10_000,
      })
      await expectLocatorCount(page.locator("[data-yaade-palette]"), 1)
      await page.keyboard.press("Escape")

      await execCommand(page, "ui.showCommandPalette")
      await expectLocatorVisible(page.getByPlaceholder("Search commands…"), {
        timeout: 10_000,
      })
      await expectLocatorCount(page.locator("[data-yaade-palette]"), 1)
    } finally {
      await app.close()
    }
  })
})
