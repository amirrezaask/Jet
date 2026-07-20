import { test } from "@playwright/test"
import { assertBudget, logBenchResult, runBench } from "./_bench.js"
import { launchJet } from "../electron/_launch.js"

test("bench theme-switch", async () => {
  const { app, page } = await launchJet()
  try {
    let dark = false
    const result = await runBench({
      name: "theme-switch",
      rounds: 9,
      measure: async () => {
        dark = !dark
        const themeId = dark ? "ayu-dark" : "ayu-light"
        const t0 = Date.now()
        await page.evaluate(async (id: string) => {
          await window.__gharargahAgent!.executeCommand(`ui.setTheme.${id}`)
        }, themeId)
        await page.waitForFunction(
          (id: string) => localStorage.getItem("jet-theme-id") === id,
          themeId,
          { timeout: 10_000 },
        )
        return Date.now() - t0
      },
    })
    logBenchResult(result)
    assertBudget(result)
  } finally {
    await app.close()
  }
})
