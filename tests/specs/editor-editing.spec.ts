import { test, expect } from "@playwright/test"
import { boot, SAMPLE, waitAnimationsIdle } from "../helpers/boot.js"
import { agent } from "../helpers/agent.js"
import { focusEditor, typeInEditor, expectEditorText } from "../helpers/editor.js"

test.beforeEach(async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/utils.ts" })
  await waitAnimationsIdle(page)
})

test("editor-editing: save persists to disk", async ({ page }) => {
  const marker = `// e2e-persist-${Date.now()}`
  await focusEditor(page)
  await page.keyboard.press("End")
  await page.keyboard.press("Enter")
  await page.keyboard.type(marker)
  await agent(page).executeCommand("workspace.saveFile")
  await page.waitForTimeout(400)

  const disk = await agent(page).readFixtureFile("src/utils.ts")
  expect(disk).toContain(marker)

  const text = await agent(page).getEditorText()
  const reverted = text!.replace(`\n${marker}`, "").replace(marker, "")
  await page.evaluate(async (content: string) => {
    const root = window.__jetAgent!.getState().workspace
    if (!root) return
    const uri = `file://${root}/src/utils.ts`.replace("file:///", "file:///")
    await window.jet!.fs.writeFile(uri, content)
  }, reverted)
  await agent(page).executeCommand("workspace.saveFile")
})

test("editor-editing: undo and redo", async ({ page }) => {
  await typeInEditor(page, "UNDO_TEST")
  await expectEditorText(page, "UNDO_TEST")

  await page.keyboard.press("Meta+z")
  await page.waitForTimeout(100)
  const afterUndo = await agent(page).getEditorText()
  expect(afterUndo).not.toContain("UNDO_TEST")

  await page.keyboard.press("Meta+Shift+z")
  await page.waitForTimeout(100)
  await expectEditorText(page, "UNDO_TEST")
})

test("editor-editing: copy line down duplicates line", async ({ page }) => {
  await focusEditor(page)
  await page.keyboard.press("Home")
  const lineCountBefore = (await agent(page).getEditorText())!.split("\n").length

  await agent(page).executeCommand("editor.copyLineDown")
  await page.waitForTimeout(150)

  const lineCountAfter = (await agent(page).getEditorText())!.split("\n").length
  expect(lineCountAfter).toBe(lineCountBefore + 1)
})
