import { test } from "@playwright/test"
import { assertBudget, logBenchResult, runBench } from "./_bench.js"
import { launchJet } from "../electron/_launch.js"

test("bench typing-latency", async () => {
  const result = await runBench({
    name: "typing-latency",
    rounds: 3,
    measure: async () => {
      const { app, page } = await launchJet()
      try {
        await page.evaluate(async () => {
          await window.__jetAgent!.openFile("src/index.ts")
          await window.__jetAgent!.waitForEditor()
        })
        await page.locator(".cm-content").click()
        const samples: number[] = []
        for (let i = 0; i < 10; i++) {
          const t0 = Date.now()
          await page.keyboard.type("a")
          samples.push(Date.now() - t0)
        }
        return samples.reduce((a, b) => a + b, 0) / samples.length
      } finally {
        await app.close()
      }
    },
  })
  logBenchResult(result)
  assertBudget(result)
})
