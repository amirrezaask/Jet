import { test, expect } from "@playwright/test"
import { boot } from "../helpers/boot.js"

test("welcome: shows Jet welcome view when no workspace", async ({ page }) => {
  await boot(page)
  await expect(page.locator("body")).toContainText("Jet")
})
