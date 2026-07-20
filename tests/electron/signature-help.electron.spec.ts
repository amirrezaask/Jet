import { test } from "@playwright/test"
import {
  expectContainsText,
  expectLocatorVisible,
  expectSelectorVisible,
} from "../shell/assert.js"

import {
  execCommand,
  hasTypescriptLanguageServer,
  launchJet,
  openFixtureFile,
  waitForDialog,
  waitForLspConnected,
} from "./_launch.js"

const SIG = ".cm-lsp-signature-tooltip"

test.describe("LSP signature help", () => {
  test.skip(!hasTypescriptLanguageServer(), "typescript-language-server not on PATH")

  test("shows signature tooltip when typing a call trigger character", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/index.ts")
      await waitForLspConnected(page)
      await page.waitForTimeout(500)

      await page.evaluate(() => window.__gharargahAgent!.setEditorSelection(1, 1))
      await page.locator(".cm-content").focus()
      await page.keyboard.press("Meta+a")
      await page.keyboard.type("function foo(x: number, y: string) {\n  return x\n}\n")
      await page.waitForTimeout(400)
      await page.keyboard.type("foo")
      await page.keyboard.type("(")

      await expectLocatorVisible(page.locator(SIG), { timeout: 15_000 })
      await expectContainsText(page, SIG, "x: number")
      await expectContainsText(page, SIG, "foo")
    } finally {
      await app.close()
    }
  })

  test("parameter-hints command is registered and retriggers signature tooltip", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/index.ts")
      await waitForLspConnected(page)
      await page.waitForTimeout(500)

      await page.evaluate(() => window.__gharargahAgent!.setEditorSelection(1, 1))
      await page.locator(".cm-content").focus()
      await page.keyboard.press("Meta+a")
      await page.keyboard.type("function foo(x: number, y: string) {\n  return x\n}\n")
      await page.waitForTimeout(400)
      await page.keyboard.type("foo")
      await page.keyboard.type("(")

      const tip = page.locator(SIG)
      await expectLocatorVisible(tip, { timeout: 15_000 })

      await execCommand(page, "editor.action.triggerParameterHints")
      await expectLocatorVisible(tip, { timeout: 10_000 })
      await expectContainsText(page, SIG, "y: string")

      await page.keyboard.press("Escape")
      await execCommand(page, "ui.showCommandPalette")
      await waitForDialog(page)
      await page.locator("[data-slot='command-input']").fill("parameter hints")
      await expectSelectorVisible(page, "[cmdk-item], [data-slot='command-item']", {
        timeout: 5_000,
      })
      await expectContainsText(page, "[role='dialog']", "Trigger Parameter Hints")
    } finally {
      await app.close()
    }
  })
})
