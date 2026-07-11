import { test } from "@playwright/test"
import { assertBudget, logBenchResult, runBench } from "./_bench.js"
import { launchJet } from "../electron/_launch.js"

test("bench palette-open", async () => {
  const result = await runBench({
    name: "palette-open",
    measure: async () => {
      const { app, page } = await launchJet()
      try {
        return await page.evaluate(async () => {
          const t0 = performance.now()
          await window.__jetAgent!.executeCommand("ui.showCommandPalette")
          const deadline = t0 + 2_000
          while (performance.now() < deadline) {
            const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
            if (dialog && dialog.getBoundingClientRect().height > 0) {
              return performance.now() - t0
            }
            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
          }
          throw new Error("palette did not become visible")
        })
      } finally {
        await app.close()
      }
    },
  })
  logBenchResult(result)
  assertBudget(result)
})
