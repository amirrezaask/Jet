import { test, expect } from "@playwright/test"
import { boot, SAMPLE, waitAnimationsIdle } from "../helpers/boot.js"
import { agent } from "../helpers/agent.js"

test("titlebar: menubar renders with file menu", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts", query: { titlebar: "1" } })
  await waitAnimationsIdle(page)

  await expect(page.locator("[data-jet-titlebar]")).toBeVisible()
  await expect(page.locator("[data-jet-titlebar]")).toContainText("File")

  await page.locator("[data-jet-titlebar]").getByText("File", { exact: true }).click()
  await page.waitForTimeout(200)
  await expect(page.locator("body")).toContainText("Save")
  await expect(page.locator("body")).toContainText("New File")
})

test("titlebar: view menu has explorer command", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts", query: { titlebar: "1" } })
  await waitAnimationsIdle(page)

  await page.locator("[data-jet-titlebar]").getByText("View", { exact: true }).click()
  await page.waitForTimeout(200)
  await expect(page.locator("body")).toContainText("Show Explorer")
})
