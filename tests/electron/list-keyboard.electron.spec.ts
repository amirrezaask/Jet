import { expect, test } from "@playwright/test"
import { execCommand, launchJet } from "./_launch.js"
import { EXPLORER_PANEL } from "../helpers/shell.js"

test.describe("electron list keyboard", () => {
  test("list.focusDown and list.open on explorer", async () => {
    const { app, page } = await launchJet()
    try {
      await execCommand(page, "explorer.show")
      await expect(page.locator(EXPLORER_PANEL)).toBeVisible()
      await page.waitForTimeout(300)

      await execCommand(page, "list.focusDown")
      await execCommand(page, "list.open")
      await page.waitForTimeout(500)
    } finally {
      await app.close()
    }
  })
})
