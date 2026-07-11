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

import { execCommand, focusEditor, launchJet, openFixtureFile, typeInEditor } from "./_launch.js"
import { REPO_ROOT } from "./_launch.js"
import { resolve } from "node:path"
import { readFileSync, writeFileSync } from "node:fs"

const FIXTURE_FILE = resolve(REPO_ROOT, "fixtures/sample-workspace/src/index.ts")
const ORIGINAL = readFileSync(FIXTURE_FILE, "utf8")

test.describe("electron editor save", () => {
  test.afterEach(() => {
    writeFileSync(FIXTURE_FILE, ORIGINAL, "utf8")
  })

  test("typing marks dirty, save persists to disk", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/index.ts")
      const marker = `// e2e-save-${Date.now()}`
      await typeInEditor(page, marker)

      await expect
        .poll(() => page.evaluate(() => window.__jetAgent!.getState().activeEditorDirty))
        .toBe(true)

      await focusEditor(page)
      await execCommand(page, "workspace.saveFile")
      await expect
        .poll(() => page.evaluate(() => window.__jetAgent!.getState().activeEditorDirty), { timeout: 15_000 })
        .toBe(false)

      const disk = await page.evaluate(() => window.__jetAgent!.readFixtureFile("src/index.ts"))
      expect(disk).toContain(marker)
    } finally {
      await app.close()
    }
  })
})
