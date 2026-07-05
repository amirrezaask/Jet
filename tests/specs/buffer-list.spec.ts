import { test, expect } from "@playwright/test"
import { boot, SAMPLE } from "../helpers/boot.js"
import { agent } from "../helpers/agent.js"
import { expectLayout, expectRowTextVisible } from "../helpers/list.js"

test.beforeEach(async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
})

test("buffer-list: shows open buffers", async ({ page }) => {
  await agent(page).openFile("package.json")
  await page.waitForTimeout(300)

  await agent(page).executeCommand("workspace.bufferList")
  await page.waitForTimeout(300)

  await expect(page.locator("body")).toContainText("Buffer")
  await expect(page.locator("body")).toContainText("index.ts")
  await expect(page.locator("body")).toContainText("package.json")
  await expect(page.locator("body")).not.toContainText("No results")
  await expect(page.locator("body")).not.toContainText("No open")

  await expectLayout(page, {
    selector: "[data-jet-list-item], [role=\"option\"]",
    minItems: 2,
    minUniqueTops: 2,
    minRowHeight: 20,
  })
  await expectRowTextVisible(page, {
    selector: "[data-jet-list-item], [role=\"option\"]",
    minItems: 2,
  })

  await page.keyboard.press("Escape")
  await page.waitForTimeout(200)

  const state = await agent(page).getState()
  expect(state.paletteOpen).toBe(false)
})

test("buffer-list: enter switches buffer", async ({ page }) => {
  await agent(page).openFile("package.json")
  await page.waitForTimeout(300)

  await agent(page).executeCommand("workspace.bufferList")
  await page.waitForTimeout(300)
  await page.keyboard.type("index")
  await page.waitForTimeout(200)
  await page.keyboard.press("Enter")
  await page.waitForTimeout(500)

  await expect(page.locator(".cm-editor")).toContainText("export function main")
})

test("buffer-list: close buffer removes it from editor", async ({ page }) => {
  await agent(page).openFile("src/utils.ts")
  await page.waitForTimeout(300)

  await expect(page.locator(".cm-editor")).toContainText("export function greet")

  await agent(page).executeCommand("workspace.closeBuffer")
  await page.waitForTimeout(400)

  await expect(page.locator(".cm-editor")).not.toContainText("export function greet")
  await expect(page.locator(".cm-editor")).toContainText("export function main")
})
