import { expect, test } from "@playwright/test"
import { launchJet, openFixtureFile } from "./_launch.js"

test("electron syntax: rust file has colored spans", async () => {
  const { app, page } = await launchJet()
  try {
    await openFixtureFile(page, "src/example.rs")
    await page.waitForTimeout(1500)

    const report = await page.evaluate(() => {
      const spans = [...document.querySelectorAll<HTMLElement>(".cm-line span")]
      const colored = spans.filter(s => {
        const c = getComputedStyle(s).color
        return c && c !== "rgba(0, 0, 0, 0)"
      })
      const colors = [...new Set(colored.map(s => getComputedStyle(s).color))]
      return { spanCount: spans.length, coloredCount: colored.length, uniqueColors: colors.length }
    })

    expect(report.spanCount).toBeGreaterThanOrEqual(8)
    expect(report.coloredCount).toBeGreaterThanOrEqual(6)
    expect(report.uniqueColors).toBeGreaterThanOrEqual(2)
  } finally {
    await app.close()
  }
})
