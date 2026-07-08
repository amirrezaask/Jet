import { test, expect } from "@playwright/test"
import { boot, SAMPLE, waitAnimationsIdle } from "../helpers/boot.js"
import { agent } from "../helpers/agent.js"
import { expectEditorAndTabInSync, INDEX_MAIN, UTILS_GREET } from "../helpers/tabs.js"
import { expectElementWidth, expectSyntaxHighlighting } from "../helpers/list.js"
import { focusEditor } from "../helpers/editor.js"
import { confirmDialog } from "../helpers/overlays.js"

test.beforeEach(async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await waitAnimationsIdle(page)
})

test("tab-lifecycle: editor opens with content and syntax highlighting", async ({ page }) => {
  await expect(page.locator(".cm-editor")).toContainText("export")
  await expect(page.locator(".cm-editor")).toContainText("function")
  await expectElementWidth(page, { selector: ".cm-editor", minPctOfViewport: 50 })
  await expectSyntaxHighlighting(page, {
    selector: ".cm-line span",
    minColoredSpans: 5,
    minUniqueColors: 2,
  })
})

test("tab-lifecycle: new untitled file", async ({ page }) => {
  await agent(page).executeCommand("workspace.newFile")
  await page.waitForTimeout(400)

  await expect(page.locator("body")).toContainText("Untitled")
  await page.locator(".cm-content").click()
  await page.keyboard.type("hello")
  await page.waitForTimeout(200)

  await expect(page.locator(".cm-editor")).toContainText("hello")
})

test("tab-lifecycle: next/previous editor navigation", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts", extraFiles: ["src/utils.ts"] })
  await waitAnimationsIdle(page)

  await expect(page.locator(".cm-editor")).toContainText("greet")

  await agent(page).executeCommand("editor.previousEditor")
  await page.waitForTimeout(300)
  await expectEditorAndTabInSync(page, "src/index.ts", { contains: INDEX_MAIN })

  await agent(page).executeCommand("editor.nextEditor")
  await page.waitForTimeout(300)
  await expectEditorAndTabInSync(page, "src/utils.ts", { contains: UTILS_GREET })
})

test("tab-lifecycle: save clears dirty flag", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/utils.ts" })
  await waitAnimationsIdle(page)

  await page.locator(".cm-content").click()
  await page.keyboard.press("End")
  await page.keyboard.type(" ")
  await page.waitForTimeout(200)

  const dirty = await agent(page).getState()
  expect(dirty.activeEditorDirty).toBe(true)

  await agent(page).executeCommand("workspace.saveFile")
  await page.waitForTimeout(400)

  const clean = await agent(page).getState()
  expect(clean.activeEditorDirty).toBe(false)
})

test("tab-lifecycle: split editor creates two panels", async ({ page }) => {
  await agent(page).executeCommand("view.splitEditor")
  await page.waitForTimeout(500)

  const locators = page.locator(".cm-editor")
  await expect(locators).toHaveCount(2)
  await expectElementWidth(page, { selector: ".cm-editor", maxPctOfViewport: 55 })
})

test("tab-lifecycle: toggle comment adds // then removes it", async ({ page }) => {
  await page.locator(".cm-content").click()
  await page.keyboard.press("Home")
  const before = await agent(page).getEditorText()
  const firstLineBefore = before!.split("\n")[0]!

  await agent(page).executeCommand("editor.toggleComment")
  await page.waitForTimeout(200)
  await expect(page.locator(".cm-editor")).toContainText("//")

  await agent(page).executeCommand("editor.toggleComment")
  await page.waitForTimeout(200)
  const after = await agent(page).getEditorText()
  expect(after!.split("\n")[0]).toBe(firstLineBefore)
})

test("tab-lifecycle: dirty close cancel keeps buffer", async ({ page }) => {
  await focusEditor(page)
  await page.keyboard.type(" DIRTY")
  await page.waitForTimeout(200)
  expect((await agent(page).getState()).activeEditorDirty).toBe(true)

  void page.evaluate(() => window.__jetAgent!.executeCommand("workspace.closeBuffer"))
  await expect(page.locator('[role="alertdialog"]')).toContainText("Unsaved changes", { timeout: 5000 })

  await confirmDialog(page, "cancel")
  await expect(page.locator(".cm-editor")).toContainText("DIRTY")
})

test("tab-lifecycle: dirty close confirm closes buffer", async ({ page }) => {
  await agent(page).openFile("src/utils.ts")
  await page.waitForTimeout(400)
  await focusEditor(page)
  await page.keyboard.type(" X")
  await page.waitForTimeout(200)

  void page.evaluate(() => window.__jetAgent!.executeCommand("workspace.closeBuffer"))
  await expect(page.locator('[role="alertdialog"]')).toBeVisible({ timeout: 5000 })
  await confirmDialog(page, "confirm")
  await page.waitForTimeout(400)

  await expect(page.locator(".cm-editor")).not.toContainText("export function greet")
})

test("tab-lifecycle: sidebar collapse hides explorer list", async ({ page }) => {
  await agent(page).executeCommand("explorer.show")
  await page.waitForTimeout(400)
  await expect(page.locator('[data-jet-list-panel="jet:explorer"]')).toBeVisible()

  await page.keyboard.press("Meta+b")
  await page.waitForTimeout(400)

  await expect(page.locator('[data-jet-workspace-sidebar]')).toHaveAttribute("data-sidebar-open", "false")
  await expect(page.locator("[data-jet-panel-leaf]")).toHaveCount(1)
})

test("tab-lifecycle: Mod-w closes buffer", async ({ page }) => {
  await agent(page).openFile("src/utils.ts")
  await page.waitForTimeout(400)
  await focusEditor(page)
  await page.keyboard.press("Meta+w")
  await page.waitForTimeout(400)
  await expect(page.locator(".cm-editor")).not.toContainText("export function greet")
})
