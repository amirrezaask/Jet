import { test, expect } from "@playwright/test"
import { boot, SAMPLE, waitAnimationsIdle } from "../helpers/boot.js"
import { agent } from "../helpers/agent.js"
import { focusEditor } from "../helpers/editor.js"
import { SEARCH_LIST_PANEL } from "../helpers/location-list.js"

test.beforeEach(async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await waitAnimationsIdle(page)
})

test("editor-keymaps: Cmd-f opens find", async ({ page }) => {
  await focusEditor(page)
  await page.keyboard.press("Meta+f")
  await page.waitForTimeout(300)
  await expect(page.locator("#jet-find-input")).toBeVisible()
  await page.keyboard.press("Escape")
})

test("editor-keymaps: Cmd-/ toggles comment", async ({ page }) => {
  await focusEditor(page)
  await page.keyboard.press("Home")
  await page.keyboard.press("Meta+/")
  await page.waitForTimeout(150)
  await expect(page.locator(".cm-editor")).toContainText("//")
})

test("editor-keymaps: previous buffer command switches content", async ({ page }) => {
  await agent(page).openFile("src/utils.ts")
  await page.waitForTimeout(400)
  await expect(page.locator(".cm-editor")).toContainText("greet")

  await agent(page).executeCommand("editor.previousEditor")
  await page.waitForTimeout(300)
  await expect(page.locator(".cm-editor")).toContainText("main")
})

test("editor-keymaps: Cmd-z undoes typing", async ({ page }) => {
  await focusEditor(page)
  await page.keyboard.type("KEYMAP")
  await page.keyboard.press("Meta+z")
  await page.waitForTimeout(100)
  const text = await agent(page).getEditorText()
  expect(text).not.toContain("KEYMAP")
})

test("editor-keymaps: Cmd-Shift-e shows explorer", async ({ page }) => {
  await page.keyboard.press("Meta+Shift+E")
  await page.waitForTimeout(400)
  await expect(page.locator('[data-jet-list-panel="jet:explorer"]')).toBeVisible()
})

test("editor-keymaps: Cmd-Shift-f opens project search", async ({ page }) => {
  await focusEditor(page)
  await page.keyboard.press("Meta+Shift+F")
  await page.waitForTimeout(400)
  await expect(page.locator(SEARCH_LIST_PANEL)).toBeVisible()
  await expect(page.locator(`${SEARCH_LIST_PANEL} input[type="search"]`)).toBeFocused()
})

test("editor-keymaps: Cmd-p quick open", async ({ page }) => {
  await page.keyboard.press("Meta+p")
  await page.waitForTimeout(300)
  await expect(page.locator("body")).toContainText("file name")
  await page.keyboard.press("Escape")
})

test("editor-keymaps: Alt-j jump back", async ({ page }) => {
  await agent(page).openFile("src/utils.ts")
  await page.waitForTimeout(400)
  await page.keyboard.press("Alt+j")
  await page.waitForTimeout(400)
  await expect(page.locator(".cm-editor")).toContainText("main")
})
