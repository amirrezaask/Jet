import { test } from "@playwright/test"
import { assertBudget, logBenchResult, runBench } from "./_bench.js"
import { launchJet } from "../electron/_launch.js"

test("bench typing-latency", async () => {
  const { app, page } = await launchJet()
  try {
    await page.evaluate(async () => {
      await window.__gharargahAgent!.openFile("src/index.ts")
      await window.__gharargahAgent!.waitForEditor()
    })
    await page.locator(".cm-content").click()
    const result = await runBench({
      name: "typing-latency",
      rounds: 30,
      measure: () => page.locator(".cm-content").evaluate(async content => {
        const started = performance.now()
        ;(content as HTMLElement).focus()
        document.execCommand("insertText", false, "a")
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
        return performance.now() - started
      }),
    })
    logBenchResult(result)
    assertBudget(result)
  } finally {
    await app.close()
  }
})
