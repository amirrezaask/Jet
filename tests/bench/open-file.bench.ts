import { test } from "@playwright/test"
import { assertBudget, logBenchResult, runBench } from "./_bench.js"
import { launchJet } from "../electron/_launch.js"

test("bench open-file", async () => {
  const result = await runBench({
    name: "open-file",
    measure: async () => {
      const { app, page } = await launchJet()
      try {
        await page.evaluate(() => window.__jetAgent!.clearPerf())
        const t0 = Date.now()
        await page.evaluate(async () => {
          await window.__jetAgent!.openFile("src/index.ts")
          await window.__jetAgent!.waitForEditor()
        })
        const measures = await page.evaluate(() => window.__jetAgent!.getPerfMeasures(["jet:editor-mounted"]))
        if (measures[0]) return measures[0].durationMs
        return Date.now() - t0
      } finally {
        await app.close()
      }
    },
  })
  logBenchResult(result)
  assertBudget(result)
})
