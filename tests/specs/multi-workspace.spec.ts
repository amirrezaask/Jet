import { test, expect } from "@playwright/test"
import { boot, SAMPLE } from "../helpers/boot.js"
import { agent } from "../helpers/agent.js"
import { EXPLORER_PANEL, showExplorer } from "../helpers/explorer.js"
import { expectLayout, expectRowTextVisible } from "../helpers/list.js"

test("multi-workspace: explorer shows multiple roots and opens file from second root", async ({
  page,
}) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await page.waitForTimeout(500)

  const stateBefore = await agent(page).getState()
  const panelCountBefore = stateBefore.panels.length

  await page.evaluate(async () => {
    await window.__jetAgent!.addWorkspace("packages/jet-shared")
  })
  await page.waitForTimeout(500)

  const workspaces = await page.evaluate(() => window.__jetAgent!.listWorkspaces())
  expect(workspaces.length).toBe(2)
  expect(workspaces.some(w => w.name === "jet-shared")).toBe(true)
  expect(workspaces.some(w => w.name === "sample-workspace")).toBe(true)

  await showExplorer(page)

  await expect(page.locator(`${EXPLORER_PANEL} [data-jet-list-item][aria-label="jet-shared"]`)).toBeVisible()
  await expect(page.locator(`${EXPLORER_PANEL} [data-jet-list-item][aria-label="sample-workspace"]`)).toBeVisible()

  await expectLayout(page, {
    selector: `${EXPLORER_PANEL} [data-jet-list-item]`,
    minItems: 4,
    minUniqueTops: 4,
    minRowHeight: 18,
  })
  await expectRowTextVisible(page, {
    selector: `${EXPLORER_PANEL} [data-jet-list-item]`,
    minItems: 4,
  })

  await page.locator(`${EXPLORER_PANEL} [data-jet-list-item][aria-label="jet-shared"]`).click()
  await page.waitForTimeout(400)
  await page.locator(`${EXPLORER_PANEL} [data-jet-list-item][aria-label="src"]`).click()
  await page.waitForTimeout(400)
  await page.locator(`${EXPLORER_PANEL} [data-jet-list-item][aria-label="index.ts"]`).click()
  await page.waitForTimeout(800)

  await expect(page.locator(".cm-editor")).toContainText("export")
  await expect(page.locator(EXPLORER_PANEL)).not.toContainText("No results")

  const stateAfter = await agent(page).getState()
  expect(stateAfter.panels.length).toBeGreaterThanOrEqual(panelCountBefore)
  expect(stateAfter.openBuffers.length).toBeGreaterThanOrEqual(1)
})

test("multi-workspace: quick open scopes to current tab workspace", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await page.waitForTimeout(3000)

  await page.evaluate(async () => {
    await window.__jetAgent!.addWorkspace("packages/jet-shared")
  })
  await page.waitForTimeout(2000)

  await agent(page).executeCommand("workspace.quickOpen")
  await page.keyboard.type("src/index.ts")
  await page.waitForTimeout(2500)

  const items = page.locator(
    '[role="dialog"] [cmdk-item]:not([data-value="__jet_no_selection__"])',
  )
  await expect(items.first()).toBeVisible()
  await expect(items.filter({ hasText: "sample-workspace" })).toHaveCount(0)
  await expect(items.filter({ hasText: "jet-shared" })).toHaveCount(0)
  await expect(page.locator('[role="dialog"]')).not.toContainText("No matching files")
  await page.keyboard.press("Escape")
})

test("multi-workspace: quick open follows focused workspace after switch", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await page.waitForTimeout(3000)

  await page.evaluate(async () => {
    await window.__jetAgent!.addWorkspace("packages/jet-shared")
  })
  await page.waitForTimeout(2000)

  await agent(page).executeCommand("workspace.switchFolder")
  await page.locator('[role="dialog"] [cmdk-item]').filter({ hasText: "jet-shared" }).click()
  await page.waitForTimeout(300)
  await agent(page).openFile("src/caret-motion.ts")
  await page.waitForTimeout(800)

  await agent(page).executeCommand("workspace.quickOpen")
  await page.keyboard.type("caret-motion")
  await page.waitForTimeout(2500)

  const items = page.locator(
    '[role="dialog"] [cmdk-item]:not([data-value="__jet_no_selection__"])',
  )
  await expect(items.first()).toBeVisible()
  await expect(items.filter({ hasText: "caret-motion" }).first()).toBeVisible()
  await expect(items.filter({ hasText: "sample-workspace" })).toHaveCount(0)
  await expect(page.locator('[role="dialog"]')).not.toContainText("No matching files")
  await page.keyboard.press("Escape")
})

test("multi-workspace: remove folder blocked while dirty then succeeds after save", async ({
  page,
}) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await page.waitForTimeout(500)

  await page.evaluate(async () => {
    await window.__jetAgent!.addWorkspace("packages/jet-shared")
  })
  await page.waitForTimeout(300)
  await agent(page).executeCommand("workspace.focusFolder")
  await page.waitForTimeout(200)

  await page.locator(".cm-editor").click()
  await page.keyboard.type("\n// dirty marker")

  const workspacesBefore = await page.evaluate(() => window.__jetAgent!.listWorkspaces())
  expect(workspacesBefore.length).toBe(2)

  await agent(page).executeCommand("workspace.removeFolder")
  await page.waitForTimeout(400)

  const workspacesAfterBlock = await page.evaluate(() => window.__jetAgent!.listWorkspaces())
  expect(workspacesAfterBlock.length).toBe(2)

  await page.keyboard.press("Meta+s")
  await page.waitForTimeout(300)
  await agent(page).executeCommand("workspace.removeFolder")
  await page.waitForTimeout(400)

  const workspacesAfter = await page.evaluate(() => window.__jetAgent!.listWorkspaces())
  expect(workspacesAfter.length).toBe(1)
})

test("multi-workspace: quick open finds files in focused workspace only", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await page.waitForTimeout(3000)

  await page.evaluate(async () => {
    await window.__jetAgent!.addWorkspace(".")
  })
  await page.waitForTimeout(2000)

  await agent(page).executeCommand("workspace.quickOpen")
  await page.keyboard.type("jet-shared/src/index")
  await page.waitForTimeout(2500)

  const option = page.locator(
    '[role="dialog"] [cmdk-item]:not([data-value="__jet_no_selection__"])',
  ).filter({ hasText: "jet-shared" })
  await expect(option).toHaveCount(0)
  await expect(page.locator('[role="dialog"]')).not.toContainText("No matching files")
  await page.keyboard.press("Escape")
})
