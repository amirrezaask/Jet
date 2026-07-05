import { test, expect } from "@playwright/test"
import { boot, SAMPLE, waitAnimationsIdle } from "../helpers/boot.js"
import { agent } from "../helpers/agent.js"
import { expectElementWidth } from "../helpers/list.js"

test.beforeEach(async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await waitAnimationsIdle(page)
})

test("editor-goto: goto line dialog opens and navigates", async ({ page }) => {
  await agent(page).executeCommand("editor.gotoLine")
  await page.waitForTimeout(300)

  await expect(page.locator("body")).toContainText("Go to Line")
  await expectElementWidth(page, { selector: "[role=\"dialog\"]", minPx: 200 })

  await page.keyboard.type("3")
  await page.waitForTimeout(150)
  await page.keyboard.press("Enter")
  await page.waitForTimeout(400)

  const state = await agent(page).getState()
  expect(state.paletteOpen).toBe(false)
})

test("editor-goto: jump back and forward between files", async ({ page }) => {
  await agent(page).openFile("src/utils.ts")
  await page.waitForTimeout(400)

  await expect(page.locator(".cm-editor")).toContainText("greet")

  await agent(page).executeCommand("navigation.jumpBack")
  await page.waitForTimeout(400)

  await expect(page.locator(".cm-editor")).toContainText("main")

  await agent(page).executeCommand("navigation.jumpForward")
  await page.waitForTimeout(400)

  await expect(page.locator(".cm-editor")).toContainText("greet")
})
