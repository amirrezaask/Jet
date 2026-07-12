import { test } from "@playwright/test"
import { assertBudget, logBenchResult, runBench } from "./_bench.js"
import { launchJet } from "../electron/_launch.js"

test("bench palette-open", async () => {
  const { app, page } = await launchJet()
  try {
    const result = await runBench({
      name: "palette-open",
      rounds: 9,
      measure: async () => {
        return await page.evaluate(async () => {
          const t0 = performance.now()
          await window.__jetAgent!.executeCommand("ui.showCommandPalette")
          const deadline = t0 + 2_000
          while (performance.now() < deadline) {
            const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
            if (dialog && dialog.getBoundingClientRect().height > 0) {
              const elapsed = performance.now() - t0
              document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
              await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
              return elapsed
            }
            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
          }
          throw new Error("palette did not become visible")
        })
      },
    })
    logBenchResult(result)
    assertBudget(result)
  } finally {
    await app.close()
  }
})
