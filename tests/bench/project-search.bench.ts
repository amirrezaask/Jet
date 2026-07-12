import { test } from "@playwright/test"
import { assertBudget, logBenchResult, runBench } from "./_bench.js"
import { launchJet, waitForSearchReady } from "../electron/_launch.js"

test("bench project-search", async () => {
  const { app, page } = await launchJet()
  let round = 0
  try {
    await page.evaluate(async () => {
      await window.__jetAgent!.openFile("src/index.ts")
      await window.__jetAgent!.waitForEditor()
    })
    await waitForSearchReady(page)
    const result = await runBench({
      name: "project-search",
      measure: async () => {
        const { query, expected } = round++ % 2 === 0
          ? { query: "greet", expected: "utils.ts" }
          : { query: "main", expected: "index.ts" }
        await page.evaluate(() => window.__jetAgent!.executeCommand("locationlist.showSearch"))
        await page.evaluate(() => {
          performance.clearMarks("jet:bench-project-search")
          performance.mark("jet:bench-project-search")
        })
        await page.locator('input[aria-label="Search project"]').click()
        await page.keyboard.press("Meta+A")
        await page.keyboard.type(query)
        return page.evaluate(async expected => {
          while (![...document.querySelectorAll('[data-jet-list-panel^="list-"] [data-jet-list-item]')]
            .some(row => row.textContent?.includes(expected))) {
            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
          }
          const started = performance.getEntriesByName("jet:bench-project-search", "mark").at(-1)!.startTime
          return performance.now() - started
        }, expected)
      },
    })
    logBenchResult(result)
    assertBudget(result)
  } finally {
    await app.close()
  }
})
