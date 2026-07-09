import { expect, test } from "@playwright/test"
import { describeFlaky } from "./_flaky.js"
import { execCommand, launchJet } from "./_launch.js"

describeFlaky("electron switch project", () => {
  test("opens project switcher overlay", async () => {
    const { app, page } = await launchJet()
    try {
      await execCommand(page, "workspace.switchProject")
      await expect(page.getByRole("dialog")).toBeVisible()
      await expect(page.getByRole("dialog")).toContainText(/project/i)
    } finally {
      await app.close()
    }
  })
})
