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
} from "../shell/assert.js"

import { launchJet, openFixtureFile, readTerminalText, REPO_ROOT, showTerminal, focusTerminal } from "./_launch.js"
import { resolve } from "node:path"

test.describe("electron workspace tab isolation", () => {
  test("restores per-workspace editor tabs when switching projects", async () => {
    const { app, page } = await launchJet()
    const samplePath = resolve(REPO_ROOT, "fixtures/sample-workspace")
    const secondPath = resolve(REPO_ROOT, "fixtures/second-workspace")
    try {
      await openFixtureFile(page, "src/index.ts")
      await expect
        .poll(() => page.evaluate(() => window.__gharargahAgent!.getEditorText()))
        .toContain("greet")

      await page.evaluate(async (p: string) => {
        await window.__gharargahAgent!.openWorkspace(p)
      }, secondPath)

      await expect
        .poll(() => page.evaluate(() => window.__gharargahAgent!.getState().activeWorkspace))
        .toContain("second-workspace")

      await page.evaluate(async () => {
        await window.__gharargahAgent!.openFile("src/marker.ts")
        await window.__gharargahAgent!.waitForEditor()
      })
      await expect
        .poll(() => page.evaluate(() => window.__gharargahAgent!.getEditorText()))
        .toContain("secondMarker")

      await page.evaluate(async (p: string) => {
        await window.__gharargahAgent!.openWorkspace(p)
      }, samplePath)

      await expect
        .poll(() => page.evaluate(() => window.__gharargahAgent!.getState().activeWorkspace))
        .toContain("sample-workspace")

      await expect
        .poll(() => page.evaluate(() => window.__gharargahAgent!.getEditorText()))
        .toContain("greet")

      const editorText = await page.evaluate(() => window.__gharargahAgent!.getEditorText())
      expect(editorText).not.toContain("secondMarker")
    } finally {
      await app.close()
    }
  })

  test("keeps a project terminal alive and replays output after switching away", async () => {
    const { app, page } = await launchJet()
    const samplePath = resolve(REPO_ROOT, "fixtures/sample-workspace")
    const secondPath = resolve(REPO_ROOT, "fixtures/second-workspace")
    try {
      await showTerminal(page)
      await focusTerminal(page)
      await page.keyboard.type("printf GHARARGAH_PTY_SURVIVES")
      await page.keyboard.press("Enter")
      await expect.poll(() => readTerminalText(page), { timeout: 15_000 }).toContain("GHARARGAH_PTY_SURVIVES")

      await page.evaluate(path => window.__gharargahAgent!.openWorkspace(path), secondPath)
      await expect
        .poll(() => page.evaluate(() => window.__gharargahAgent!.getState().activeWorkspace))
        .toBe(secondPath)
      await expectLocatorCount(page.locator("[data-gharargah-terminal-panel]"), 0)

      await page.evaluate(path => window.__gharargahAgent!.openWorkspace(path), samplePath)
      await expect
        .poll(() => page.evaluate(() => window.__gharargahAgent!.getState().activeWorkspace))
        .toBe(samplePath)
      await expectSelectorVisible(page, "[data-gharargah-terminal-panel]")
      await expect.poll(() => readTerminalText(page)).toContain("GHARARGAH_PTY_SURVIVES")
    } finally {
      await app.close()
    }
  })
})
