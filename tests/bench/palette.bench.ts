import { test } from "@playwright/test"
import { assertBudget, logBenchResult, runBench } from "./_bench.js"
import { launchJet } from "../electron/_launch.js"

test("bench palette-open", async () => {
  const result = await runBench({
    name: "palette-open",
    measure: async () => {
      const { app, page } = await launchJet()
      try {
        const t0 = Date.now()
        await page.evaluate(async () => {
          await window.__jetAgent!.executeCommand("ui.showCommandPalette")
        })
        await page.getByRole("dialog").waitFor({ state: "visible", timeout: 10_000 })
        return Date.now() - t0
      } finally {
        await app.close()
      }
    },
  })
  logBenchResult(result)
  assertBudget(result)
})
