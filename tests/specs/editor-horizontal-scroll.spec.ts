import { test, expect } from "@playwright/test"
import { boot, SAMPLE } from "../helpers/boot.js"
import { focusEditor } from "../helpers/editor.js"

test("editor scrolls horizontally for long lines", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts", width: 800, height: 600 })
  await focusEditor(page)
  await page.keyboard.press("Meta+End")
  await page.keyboard.press("Enter")
  await page.keyboard.type(`const veryLongLine = "${"x".repeat(200)}";`)

  const metrics = await page.evaluate(() => {
    const scroller = document.querySelector(".cm-scroller")
    if (!scroller) return null
    const styles = getComputedStyle(scroller)
    return {
      overflowX: styles.overflowX,
      scrollWidth: scroller.scrollWidth,
      clientWidth: scroller.clientWidth,
    }
  })

  expect(metrics).not.toBeNull()
  expect(metrics!.overflowX).not.toBe("hidden")
  expect(metrics!.scrollWidth).toBeGreaterThan(metrics!.clientWidth)

  await page.evaluate(() => {
    const scroller = document.querySelector(".cm-scroller")!
    scroller.scrollLeft = 400
  })

  const scrollLeft = await page.evaluate(() => document.querySelector(".cm-scroller")!.scrollLeft)
  expect(scrollLeft).toBeGreaterThan(0)
})
