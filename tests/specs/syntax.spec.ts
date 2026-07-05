import { test, expect } from "@playwright/test"
import { boot, SAMPLE, waitAnimationsIdle } from "../helpers/boot.js"
import { expectSyntaxHighlighting } from "../helpers/list.js"

test("syntax: rust and typescript files get keyword colors", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/example.rs" })
  await waitAnimationsIdle(page)

  await expectSyntaxHighlighting(page, {
    selector: ".cm-line span",
    minColoredSpans: 8,
    minUniqueColors: 3,
    requireKeywordColor: true,
  })

  await page.evaluate(async () => {
    await window.__jetAgent!.openFile("src/index.ts")
    await window.__jetAgent!.waitForEditor()
  })
  await waitAnimationsIdle(page)

  await expectSyntaxHighlighting(page, {
    selector: ".cm-line span",
    minColoredSpans: 8,
    minUniqueColors: 3,
    requireKeywordColor: true,
  })
})

test("syntax: debug view shows multiple token colors", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await waitAnimationsIdle(page)

  const report = await page.evaluate(() => {
    const spans = [...document.querySelectorAll<HTMLElement>(".cm-line span")]
    const colored = spans.filter(s => {
      const c = getComputedStyle(s).color
      return c && c !== "rgba(0, 0, 0, 0)"
    })
    const colors = [...new Set(colored.map(s => getComputedStyle(s).color))]
    return { spanCount: spans.length, coloredCount: colored.length, uniqueColors: colors.length }
  })

  expect(report.spanCount).toBeGreaterThanOrEqual(10)
  expect(report.coloredCount).toBeGreaterThanOrEqual(8)
  expect(report.uniqueColors).toBeGreaterThanOrEqual(3)
})
