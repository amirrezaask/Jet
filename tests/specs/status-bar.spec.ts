import { test, expect } from "@playwright/test"
import { boot, SAMPLE, waitAnimationsIdle } from "../helpers/boot.js"
import { agent } from "../helpers/agent.js"
import { focusEditor } from "../helpers/editor.js"

test.beforeEach(async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await waitAnimationsIdle(page)
})

test("status-bar: cursor line updates on move", async ({ page }) => {
  await focusEditor(page)
  await agent(page).setEditorSelection(3, 1)
  await page.waitForTimeout(200)

  await expect(page.locator("footer")).toContainText("Ln 3")
})

test("status-bar: LSP off in browser dev", async ({ page }) => {
  await expect(page.locator("footer")).toContainText("LSP off")
})

test("status-bar: shows active filename", async ({ page }) => {
  await expect(page.locator("footer")).toContainText("index.ts")
})

test("status-bar: LSP popover opens on click", async ({ page }) => {
  await page.locator("footer").getByRole("button", { name: /Language Server/i }).click()
  await page.waitForTimeout(300)
  await expect(page.locator("body")).toContainText(/Language server/i)
})
