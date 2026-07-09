import { test } from "@playwright/test"
import { assertBudget, logBenchResult, runBench } from "./_bench.js"
import { launchJet } from "../electron/_launch.js"

test("bench quick-open", async () => {
  const result = await runBench({
    name: "quick-open",
    measure: async () => {
      const { app, page } = await launchJet()
      try {
        const t0 = Date.now()
        await page.evaluate(async () => {
          await window.__jetAgent!.executeCommand("workspace.quickOpen")
        })
        await page.getByRole("dialog").getByRole("combobox").fill("index")
        await page.getByRole("option").filter({ hasText: "index.ts" }).first().waitFor({ timeout: 10_000 })
        return Date.now() - t0
      } finally {
        await app.close()
      }
    },
  })
  logBenchResult(result)
  assertBudget(result)
})
