import { test } from "@playwright/test"
import { assertBudget, logBenchResult, runBench } from "./_bench.js"
import { launchJet, waitForSearchReady } from "../electron/_launch.js"

test("bench quick-open", async () => {
  const { app, page } = await launchJet()
  try {
    await waitForSearchReady(page)
    const result = await runBench({
      name: "quick-open",
      measure: async () => {
        const duration = await page.evaluate(async () => {
          const started = performance.now()
          await window.__jetAgent!.executeCommand("workspace.quickOpen")
          let input: HTMLInputElement | null = null
          while (!(input = document.querySelector('[role="dialog"] [role="combobox"]'))) {
            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
          }
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
          setter.call(input, "index")
          input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "index" }))
          while (![...document.querySelectorAll('[role="option"]')].some(row => row.textContent?.includes("index.ts"))) {
            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
          }
          return performance.now() - started
        })
        await page.keyboard.press("Escape")
        return duration
      },
    })
    logBenchResult(result)
    assertBudget(result)
  } finally {
    await app.close()
  }
})
