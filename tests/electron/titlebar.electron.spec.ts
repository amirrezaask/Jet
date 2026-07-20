import { expect, test } from "@playwright/test"
import { expectLocatorCount, expectSelectorVisible } from "../shell/assert.js"
import { launchJet } from "./_launch.js"

test.describe("desktop shell", () => {
  test("uses native window chrome without a custom titlebar", async () => {
    const { app, page } = await launchJet()
    try {
      await expectSelectorVisible(page, "[data-gharargah-home]")
      await expectLocatorCount(page.locator("[data-gharargah-titlebar]"), 0)
      await expectLocatorCount(page.locator("[data-gharargah-home-button]"), 0)
      await expectLocatorCount(page.locator("[data-gharargah-traffic-light-spacer]"), 0)
    } finally {
      await app.close()
    }
  })
})
