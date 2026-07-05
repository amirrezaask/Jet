import { test, expect } from "@playwright/test"
import { boot, SAMPLE, waitAnimationsIdle } from "../helpers/boot.js"
import { agent } from "../helpers/agent.js"

test.beforeEach(async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await waitAnimationsIdle(page)
})

test("overlays: open file picker opens package.json", async ({ page }) => {
  await agent(page).executeCommand("workspace.openFile")
  await page.waitForTimeout(400)
  await expect(page.locator('[role="dialog"]')).toBeVisible()

  await page.keyboard.type("package.json")
  await page.waitForTimeout(400)
  await page.keyboard.press("Enter")
  await page.waitForTimeout(800)

  await expect(page.locator(".cm-editor")).toContainText('"name"')
})

test("overlays: change directory overlay opens", async ({ page }) => {
  await agent(page).executeCommand("workspace.cd")
  await page.waitForTimeout(400)
  await expect(page.locator('[role="dialog"]')).toBeVisible()
  await page.keyboard.press("Escape")
})

test("overlays: switch project overlay opens", async ({ page }) => {
  await agent(page).executeCommand("workspace.switchProject")
  await page.waitForTimeout(400)
  await expect(page.locator('[role="dialog"]')).toBeVisible()
  await page.keyboard.press("Escape")
})

test("overlays: refresh projects shows toast message", async ({ page }) => {
  await agent(page).executeCommand("workspace.refreshProjects")
  await page.waitForTimeout(800)
  await expect(page.locator("body")).toContainText(/project|Found|No git/i)
})
