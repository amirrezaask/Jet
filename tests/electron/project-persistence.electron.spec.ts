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

import { resolve } from "node:path"
import { expectLayout, expectNoOverlap, expectRowSpacing, expectRowTextVisible } from "../helpers/list.js"
import { launchJet, REPO_ROOT } from "./_launch.js"

const PANEL = "[data-jet-list-panel='jet:terminal-explorer']"
const ROWS = `${PANEL} [data-jet-list-item]`

test.describe("electron project persistence", () => {
  test("restores only saved projects and the last active project", async () => {
    const secondPath = resolve(REPO_ROOT, "fixtures/second-workspace")

    const { app, page } = await launchJet()
    try {
      await page.evaluate(path => window.__jetAgent!.openWorkspace(path), secondPath)
      await expect
        .poll(() => page.evaluate(() => window.__jetAgent!.getState().activeWorkspace))
        .toBe(secondPath)
      const secondRow = page.getByRole("treeitem", { name: "second-workspace" })
      await secondRow.getByRole("button", { name: "New terminal" }).click()
      await expectSelectorVisible(page, "[data-jet-terminal-panel]")
      await page.evaluate(() => window.__jetAgent!.openFile("src/marker.ts"))
      await page.evaluate(() => window.__jetAgent!.waitForEditor())
      await expect
        .poll(() => page.evaluate(() => window.__jetAgent!.listWorkspaces().length))
        .toBe(2)

      await page.reload()
      await page.waitForFunction(() => window.__jetAgent != null, null, { timeout: 30_000 })
      await page.evaluate(() => window.__jetAgent!.waitForReady())
      await expect
        .poll(() => page.evaluate(() => window.__jetAgent!.listWorkspaces().length))
        .toBe(2)
      await expect
        .poll(() => page.evaluate(() => window.__jetAgent!.getState().activeWorkspace))
        .toBe(secondPath)

      const panel = page.locator(PANEL)
      await expectLocatorContainsText(panel, "sample-workspace")
      await expectLocatorContainsText(panel, "second-workspace")
      await expect.poll(async () => !(await panel.evaluate(el => el.textContent ?? "")).includes("No results")).toBe(true)
      await expectLayout(page, { selector: ROWS, minItems: 2, minUniqueTops: 2 })
      await expectNoOverlap(page, { selector: ROWS, minItems: 2 })
      await expectRowSpacing(page, { selector: ROWS, minItems: 2 })
      await expectRowTextVisible(page, { selector: ROWS, minItems: 2 })

      await expectLocatorCount(page.locator("[data-jet-terminal-panel]"), 0)
      await expectLocatorCount(page.locator(".cm-editor"), 0)
    } finally {
      await app.close()
    }
  })
})
