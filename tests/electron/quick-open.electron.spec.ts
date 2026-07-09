import { expect, test } from "@playwright/test"
import { execCommand, launchJet, openQuickOpen } from "./_launch.js"

test.describe("electron quick open", () => {
  test("lists matching files and opens selection", async () => {
    const { app, page } = await launchJet()
    try {
      await openQuickOpen(page)
      const input = page.getByRole("dialog").getByRole("combobox")
      await input.fill("utils")
      await page.waitForTimeout(800)
      await expect(page.getByRole("dialog")).toContainText("utils.ts")
      await page.getByRole("option").filter({ hasText: "utils.ts" }).first().click()
      await page.evaluate(() => window.__jetAgent!.waitForEditor())
      await expect(page.locator(".cm-editor")).toContainText("export function greet")
    } finally {
      await app.close()
    }
  })
})
