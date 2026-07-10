import { expect, test } from "@playwright/test"
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
      await expect(page.locator("[data-jet-terminal-panel]")).toBeVisible()
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
      await expect(panel).toContainText("sample-workspace")
      await expect(panel).toContainText("second-workspace")
      await expect(panel).not.toContainText("No results")
      await expectLayout(page, { selector: ROWS, minItems: 2, minUniqueTops: 2 })
      await expectNoOverlap(page, { selector: ROWS, minItems: 2 })
      await expectRowSpacing(page, { selector: ROWS, minItems: 2 })
      await expectRowTextVisible(page, { selector: ROWS, minItems: 2 })

      await expect(page.locator("[data-jet-terminal-panel]")).toHaveCount(0)
      await expect(page.locator(".cm-editor")).toHaveCount(0)
    } finally {
      await app.close()
    }
  })
})
