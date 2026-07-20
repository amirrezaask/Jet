import { test } from "@playwright/test"
import { launchJet, openFixtureFile } from "../electron/_launch.js"
import { assertBudget, logBenchResult, runBench } from "./_bench.js"

test("editor wheel reaches the next paint within budget", async () => {
  const { app, page } = await launchJet(".")
  try {
    await openFixtureFile(page, "packages/gharargah-app/src/App.tsx")
    const result = await runBench({
      name: "scroll-next-paint",
      rounds: 12,
      measure: () => page.locator(".cm-scroller").evaluate(async scroller => {
        const started = performance.now()
        scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: 120, bubbles: true, cancelable: true }))
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
