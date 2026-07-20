import { test } from "@playwright/test"
import { assertBudget, logBenchResult, runBench } from "./_bench.js"
import { launchJet } from "../electron/_launch.js"

test("bench open-file", async () => {
  const { app, page } = await launchJet()
  const files = ["src/index.ts", "src/utils.ts", "src/example.rs", "src/example.go"]
  let fileIndex = 0
  try {
    const result = await runBench({
      name: "open-file",
      measure: async () => {
        const file = files[fileIndex++ % files.length]!
        const duration = await page.evaluate(async path => {
          const started = performance.now()
          await window.__gharargahAgent!.openFile(path)
          await window.__gharargahAgent!.waitForEditor()
          return performance.now() - started
        }, file)
        await page.evaluate(() => window.__gharargahAgent!.executeCommand("workspace.closeBuffer"))
        await page.waitForFunction(() => document.querySelector(".cm-editor") == null)
        return duration
      },
    })
    logBenchResult(result)
    assertBudget(result)
  } finally {
    await app.close()
  }
})
