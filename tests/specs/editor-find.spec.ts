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

  const float = page.locator("[data-jet-panel-float]")
  await expect(float).toBeVisible()
  await expect(page.locator("#jet-find-input")).toBeVisible()
  await page.keyboard.type("export")
  await page.waitForTimeout(200)

  await expectElementWidth(page, { selector: "#jet-find-input", minPx: 40 })
  await page.keyboard.press("Escape")
  await page.waitForTimeout(200)
})

test("editor-find: find next navigates matches", async ({ page }) => {
  await agent(page).executeCommand("editor.find")
  await page.waitForTimeout(300)
  await page.locator("#jet-find-input").fill("export")
  await page.waitForTimeout(200)

  await page.getByRole("button", { name: "Next", exact: true }).click()
  await page.waitForTimeout(200)
  await page.getByRole("button", { name: "Next", exact: true }).click()
  await page.waitForTimeout(200)

  await expect(page.locator("#jet-find-input")).toHaveValue("export")
  await page.getByRole("button", { name: "Close", exact: true }).click()
})

test("editor-find: replace panel opens", async ({ page }) => {
  await agent(page).executeCommand("editor.replace")
  await page.waitForTimeout(400)

  await expect(page.locator("#jet-replace-input")).toBeVisible()
  await page.keyboard.press("Escape")
  await page.waitForTimeout(200)
})

test("editor-find: replace all updates buffer", async ({ page }) => {
  await agent(page).executeCommand("editor.replace")
  await page.waitForTimeout(400)

  await page.locator("#jet-find-input").fill("Jet")
  await page.locator("#jet-replace-input").fill("World")
  await page.waitForTimeout(200)

  await page.getByRole("button", { name: "All", exact: true }).click()
  await page.waitForTimeout(300)

  const text = await agent(page).getEditorText()
  expect(text).toContain("World")
  expect(text).not.toContain('greet("Jet")')

  // Revert
  await agent(page).executeCommand("editor.replace")
  await page.waitForTimeout(300)
  await page.locator("#jet-find-input").fill("World")
  await page.locator("#jet-replace-input").fill("Jet")
  await page.getByRole("button", { name: "All", exact: true }).click()
  await page.waitForTimeout(300)
  await agent(page).executeCommand("workspace.saveFile")
})
