import { test, expect } from "@playwright/test"
import { boot, SAMPLE, waitAnimationsIdle } from "../helpers/boot.js"
import { agent } from "../helpers/agent.js"
import { expectElementWidth } from "../helpers/list.js"

test.beforeEach(async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await waitAnimationsIdle(page)
})

test("editor-find: find panel opens and shows input", async ({ page }) => {
  await agent(page).executeCommand("editor.find")
  await page.waitForTimeout(300)

  await expect(page.locator("body")).toContainText("Find")
  await page.keyboard.type("export")
  await page.waitForTimeout(200)

  await expectElementWidth(page, { selector: "#jet-find-input", minPx: 40 })
  await page.keyboard.press("Escape")
  await page.waitForTimeout(200)
})

test("editor-find: replace panel opens", async ({ page }) => {
  await agent(page).executeCommand("editor.replace")
  await page.waitForTimeout(400)

  await expect(page.locator("body")).toContainText("Replace")
  await page.keyboard.press("Escape")
  await page.waitForTimeout(200)
})
