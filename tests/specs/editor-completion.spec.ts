import { test, expect } from "@playwright/test"
import { boot, SAMPLE } from "../helpers/boot.js"

test.beforeEach(async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await page.waitForTimeout(500)
})

test("editor-completion: console.l shows autocomplete", async ({ page }) => {
  await page.locator(".cm-content").click()
  await page.keyboard.press("End")
  await page.keyboard.press("Enter")
  await page.keyboard.type("console.l")
  await page.waitForTimeout(400)

  await expect(page.locator(".cm-tooltip-autocomplete")).toContainText("log")
  await page.keyboard.press("Escape")
})

test("editor-completion: local symbol autocomplete", async ({ page }) => {
  await page.locator(".cm-content").click()
  await page.keyboard.press("End")
  await page.keyboard.type(" gre")
  await page.waitForTimeout(400)

  await expect(page.locator(".cm-tooltip-autocomplete")).toContainText("greet")
  await page.keyboard.press("Escape")
})

test("editor-completion: context menu has expected items", async ({ page }) => {
  await page.locator(".cm-editor").click({ button: "right" })
  await page.waitForTimeout(200)

  await expect(page.locator("body")).toContainText("Cut")
  await expect(page.locator("body")).toContainText("Copy")
  await expect(page.locator("body")).toContainText("Paste")
  await expect(page.locator("body")).toContainText("Go to Definition")
  await page.keyboard.press("Escape")
})
