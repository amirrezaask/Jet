import { expect, test } from "@playwright/test"
import { boot, SAMPLE } from "../helpers/boot.js"
import { agent } from "../helpers/agent.js"

test("editor: only active editor remains mounted after file switch", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })

  await agent(page).executeCommand("workspace.openFile")
  await expect(page.locator('[role="dialog"]')).toBeVisible()
  await page.keyboard.type("package.json")
  await page.keyboard.press("Enter")
  await page.waitForTimeout(600)

  await expect(page.locator(".cm-editor")).toHaveCount(1)

  await page.locator('[data-tab-id$="src/index.ts"]').click()
  await page.waitForTimeout(200)
  await expect(page.locator(".cm-editor")).toHaveCount(1)
  await expect(page.locator(".cm-editor")).toContainText("export function main")
})
