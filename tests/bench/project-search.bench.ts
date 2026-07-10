import { test } from "@playwright/test"
import { assertBudget, logBenchResult, runBench } from "./_bench.js"
import { launchJet, waitForSearchReady } from "../electron/_launch.js"

test("bench project-search", async () => {
  const result = await runBench({
    name: "project-search",
    measure: async () => {
      const { app, page } = await launchJet()
      try {
        await page.evaluate(async () => {
          await window.__jetAgent!.openFile("src/index.ts")
          await window.__jetAgent!.waitForEditor()
        })
        await waitForSearchReady(page)
        const t0 = Date.now()
        await page.evaluate(async () => {
          await window.__jetAgent!.executeCommand("locationlist.showSearch")
        })
        await page.locator('input[type="search"]').click()
        await page.keyboard.type("greet")
        await page.waitForFunction(
          () => document.querySelectorAll('[data-jet-list-panel^="list-"] [data-jet-list-item]').length >= 1,
          null,
          { timeout: 15_000 },
        )
        return Date.now() - t0
      } finally {
        await app.close()
      }
    },
  })
  logBenchResult(result)
  assertBudget(result)
})
