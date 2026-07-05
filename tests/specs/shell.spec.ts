import { test, expect } from "@playwright/test"
import { boot, SAMPLE, waitAnimationsIdle } from "../helpers/boot.js"
import { agent } from "../helpers/agent.js"
import { expectElementWidth, expectSyntaxHighlighting } from "../helpers/list.js"

test.beforeEach(async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await waitAnimationsIdle(page)
})

test("shell: problems panel opens", async ({ page }) => {
  await agent(page).executeCommand("locationlist.showProblems")
  await page.waitForTimeout(400)

  await expect(page.locator("body")).toContainText("Problems")
})

test("shell: output panel opens with usable width", async ({ page }) => {
  await agent(page).executeCommand("output.show")
  await page.waitForTimeout(400)

  await expect(page.locator("body")).toContainText("Output")
  await expectElementWidth(page, {
    selector: '[data-jet-panel-kind="output"], [data-jet-list-panel="output"]',
    minPx: 100,
  })
})

test("shell: status bar shows LSP and workspace tooltip on hover", async ({ page }) => {
  await expect(page.locator("footer")).toContainText("LSP")

  await page.locator("footer .jet-status-zone").first().hover()
  await page.waitForTimeout(700)

  await expect(page.locator("body")).toContainText("sample-workspace")
})

test("shell: dark shell has syntax highlighting in editor", async ({ page }) => {
  await expect(page.locator(".cm-editor")).toContainText("export")
  await expect(page.locator("footer")).toContainText("LSP")
  await expectSyntaxHighlighting(page, {
    selector: ".cm-line span",
    minColoredSpans: 5,
    minUniqueColors: 2,
  })
})

test("shell: toggle color scheme preserves syntax highlighting", async ({ page }) => {
  await expectSyntaxHighlighting(page, {
    selector: ".cm-line span",
    minColoredSpans: 5,
    minUniqueColors: 2,
  })

  await agent(page).executeCommand("ui.toggleColorScheme")
  await waitAnimationsIdle(page)

  await expectSyntaxHighlighting(page, {
    selector: ".cm-line span",
    minColoredSpans: 5,
    minUniqueColors: 2,
  })

  await agent(page).executeCommand("ui.toggleColorScheme")
  await page.waitForTimeout(300)
})

test("shell: zoom in/out updates font size", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts", fontSize: 13 })
  await waitAnimationsIdle(page)

  let state = await agent(page).getState()
  expect(state.fontSize).toBe(13)

  await agent(page).executeCommand("ui.zoomIn")
  await page.waitForTimeout(100)
  state = await agent(page).getState()
  expect(state.fontSize).toBe(15)

  await agent(page).executeCommand("ui.zoomIn")
  await page.waitForTimeout(100)
  state = await agent(page).getState()
  expect(state.fontSize).toBe(17)

  await agent(page).executeCommand("ui.zoomOut")
  await page.waitForTimeout(100)
  state = await agent(page).getState()
  expect(state.fontSize).toBe(15)

  await agent(page).executeCommand("ui.zoomOut")
  await page.waitForTimeout(100)
  state = await agent(page).getState()
  expect(state.fontSize).toBe(13)
})

test("shell: zoom keybindings match commands", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts", fontSize: 13 })
  await page.locator(".cm-content").click()

  await page.keyboard.press("Meta+Equal")
  await page.waitForTimeout(100)
  expect((await agent(page).getState()).fontSize).toBe(15)

  await page.keyboard.press("Meta+Minus")
  await page.waitForTimeout(100)
  expect((await agent(page).getState()).fontSize).toBe(13)
})

test("shell: design flow — welcome, editor, palette, quick open, location list, theme", async ({
  page,
}) => {
  await page.goto("/")
  await page.waitForFunction(() => window.__jetAgent != null)
  await agent(page).waitForReady()
  await waitAnimationsIdle(page)

  await expect(page.locator("body")).toContainText("Jet")

  await agent(page).openWorkspace(SAMPLE)
  await agent(page).openFile("src/index.ts")
  await agent(page).waitForEditor()
  await expect(page.locator(".cm-editor")).toBeVisible()

  await agent(page).executeCommand("ui.showCommandPalette")
  await waitAnimationsIdle(page)
  await expect(page.locator("body")).toContainText("Command palette")
  await page.keyboard.press("Escape")

  await agent(page).executeCommand("workspace.quickOpen")
  await page.waitForTimeout(200)
  await expect(page.locator("body")).toContainText("file name")
  await page.keyboard.press("Escape")

  await agent(page).executeCommand("locationlist.show")
  await page.waitForTimeout(300)
  await expect(page.locator('[data-jet-list-panel="locationlist"]')).toBeVisible()

  await agent(page).executeCommand("ui.toggleColorScheme")
  await waitAnimationsIdle(page)

  const state = await agent(page).getState()
  expect(state.paletteOpen).toBe(false)
})
