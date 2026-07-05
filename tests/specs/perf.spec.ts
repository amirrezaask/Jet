import { test, expect } from "@playwright/test"
import { boot, SAMPLE, waitAnimationsIdle } from "../helpers/boot.js"
import { agent } from "../helpers/agent.js"
import { focusEditor } from "../helpers/editor.js"

// Perf budgets. Measured on the page via performance.mark/measure and read
// back through performance.getEntriesByType. These are guard rails against
// regression, not competitive numbers — CI machines are slow.
//
// Adjust upward only with a paired investigation note.
const BUDGETS = {
  keystrokeP95Ms: 24,
  paletteFilterP95Ms: 40,
  tabSwitchP95Ms: 120,
}

async function collectMeasures(page: import("@playwright/test").Page, name: string): Promise<number[]> {
  return page.evaluate(n => {
    const entries = performance.getEntriesByType("measure") as PerformanceMeasure[]
    return entries.filter(e => e.name === n).map(e => e.duration)
  }, name)
}

function p95(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))
  return sorted[idx]!
}

test.beforeEach(async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/utils.ts" })
  await waitAnimationsIdle(page)
  await page.evaluate(() => performance.clearMeasures())
})

test("perf: keystroke echo stays within budget", async ({ page }) => {
  await focusEditor(page)
  for (let i = 0; i < 40; i++) {
    await page.evaluate(i => performance.mark(`ks:${i}:start`), i)
    await page.keyboard.type("x")
    await page.evaluate(i => {
      performance.mark(`ks:${i}:end`)
      performance.measure("perf.keystroke", `ks:${i}:start`, `ks:${i}:end`)
    }, i)
  }
  const durations = await collectMeasures(page, "perf.keystroke")
  expect(durations.length).toBeGreaterThan(30)
  const p = p95(durations)
  const mean = durations.reduce((a, b) => a + b, 0) / durations.length
  console.log(`[perf] keystroke n=${durations.length} mean=${mean.toFixed(2)}ms p95=${p.toFixed(2)}ms`)
  expect.soft(p, `keystroke p95 = ${p.toFixed(2)}ms`).toBeLessThan(BUDGETS.keystrokeP95Ms)
})

test("perf: palette filter stays within budget", async ({ page }) => {
  await agent(page).executeCommand("commandPalette.open")
  await page.waitForTimeout(50)
  for (const key of "editor".split("")) {
    await page.evaluate(k => performance.mark(`pf:${k}:start`), key)
    await page.keyboard.type(key)
    await page.evaluate(k => {
      performance.mark(`pf:${k}:end`)
      performance.measure("perf.paletteFilter", `pf:${k}:start`, `pf:${k}:end`)
    }, key)
  }
  const durations = await collectMeasures(page, "perf.paletteFilter")
  expect(durations.length).toBeGreaterThan(3)
  const p = p95(durations)
  const mean = durations.reduce((a, b) => a + b, 0) / durations.length
  console.log(`[perf] paletteFilter n=${durations.length} mean=${mean.toFixed(2)}ms p95=${p.toFixed(2)}ms`)
  expect.soft(p, `paletteFilter p95 = ${p.toFixed(2)}ms`).toBeLessThan(BUDGETS.paletteFilterP95Ms)
})
