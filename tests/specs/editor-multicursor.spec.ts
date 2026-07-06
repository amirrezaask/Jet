import { test, expect } from "@playwright/test"
import { boot, SAMPLE, waitAnimationsIdle } from "../helpers/boot.js"
import { agent } from "../helpers/agent.js"
import { focusEditor, runEditorCommand } from "../helpers/editor.js"

async function waitForRangeCount(page: import("@playwright/test").Page, min: number): Promise<void> {
  await page.waitForFunction(
    expected => (window.__jetAgent?.getSelectionRangeCount() ?? 0) >= expected,
    min,
    { timeout: 8000 },
  )
}

async function placeCursorOnParameterName(page: import("@playwright/test").Page): Promise<void> {
  await focusEditor(page)
  await agent(page).setEditorSelection(1, 23)
  await page.waitForFunction(
    () => window.__jetAgent?.getCursorPosition()?.line === 1,
    null,
    { timeout: 3000 },
  )
}

test.beforeEach(async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/utils.ts" })
  await waitAnimationsIdle(page)
  await agent(page).waitForEditor()
})

test("editor-multicursor: select next occurrence command", async ({ page }) => {
  await placeCursorOnParameterName(page)
  await runEditorCommand(page, "editor.selectNextOccurrence")
  await page.waitForTimeout(100)
  await runEditorCommand(page, "editor.selectNextOccurrence")
  await waitForRangeCount(page, 2)
})

test("editor-multicursor: Cmd+d adds next occurrence", async ({ page }) => {
  await placeCursorOnParameterName(page)
  await page.locator(".cm-content").press("Meta+d")
  await page.waitForTimeout(100)
  await page.locator(".cm-content").press("Meta+d")
  await waitForRangeCount(page, 2)
})

test("editor-multicursor: add cursor below command", async ({ page }) => {
  await focusEditor(page)
  await agent(page).setEditorSelection(1, 1)
  await runEditorCommand(page, "editor.addCursorBelow")
  await waitForRangeCount(page, 2)
})

test("editor-multicursor: Cmd-Alt-ArrowDown adds cursor below (VS Code default)", async ({ page }) => {
  await focusEditor(page)
  await agent(page).setEditorSelection(1, 1)
  await page.locator(".cm-content").press("Meta+Alt+ArrowDown")
  await waitForRangeCount(page, 2)
})

test("editor-multicursor: skip next occurrence command", async ({ page }) => {
  await placeCursorOnParameterName(page)
  await runEditorCommand(page, "editor.selectNextOccurrence")
  await page.waitForTimeout(100)
  await runEditorCommand(page, "editor.selectNextOccurrence")
  await waitForRangeCount(page, 2)
  await runEditorCommand(page, "editor.skipNextOccurrence")
  expect(await agent(page).getSelectionRangeCount()).toBe(1)
})

test("editor-multicursor: Cmd+K Cmd+D skips an occurrence", async ({ page }) => {
  await placeCursorOnParameterName(page)
  await runEditorCommand(page, "editor.selectNextOccurrence")
  await page.waitForTimeout(100)
  await runEditorCommand(page, "editor.selectNextOccurrence")
  await waitForRangeCount(page, 2)
  await focusEditor(page)
  await page.locator(".cm-content").press("Meta+k")
  await page.waitForTimeout(100)
  await page.locator(".cm-content").press("Meta+d")
  await page.waitForTimeout(150)
  expect(await agent(page).getSelectionRangeCount()).toBe(1)
})

test("editor-multicursor: select all occurrences command", async ({ page }) => {
  await placeCursorOnParameterName(page)
  await page.locator(".cm-content").press("Meta+d")
  await runEditorCommand(page, "editor.selectAllOccurrences")
  await waitForRangeCount(page, 2)
})

test("editor-multicursor: Ctrl+Shift+ArrowDown adds cursor below", async ({ page }) => {
  await focusEditor(page)
  await agent(page).setEditorSelection(1, 1)
  await page.locator(".cm-content").press("Control+Shift+ArrowDown")
  await waitForRangeCount(page, 2)
})
