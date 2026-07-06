import { expect, test } from "@playwright/test"
import { boot, SAMPLE } from "../helpers/boot.js"

test("perf: boot settles without long-lived animations", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/utils.ts" })
  await page.waitForTimeout(100)
  const animationCount = await page.evaluate(() => document.getAnimations().length)
  expect(animationCount).toBe(0)
})
