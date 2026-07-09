import { test } from "@playwright/test"
import { _electron as electron } from "@playwright/test"
import { assertBudget, logBenchResult, runBench } from "./_bench.js"
import { DESKTOP_DIR, MAIN_JS, REPO_ROOT } from "../electron/_launch.js"
import { resolve } from "node:path"

const SAMPLE = resolve(REPO_ROOT, "fixtures/sample-workspace")

test("bench cold-start", async () => {
  const result = await runBench({
    name: "cold-start",
    warmup: 1,
    rounds: 3,
    measure: async () => {
      const t0 = Date.now()
      const app = await electron.launch({
        args: [MAIN_JS, "--", SAMPLE],
        cwd: DESKTOP_DIR,
        env: { ...process.env, JET_E2E: "1" },
      })
      try {
        let page = null as Awaited<ReturnType<typeof app.firstWindow>> | null
        for (let i = 0; i < 80; i++) {
          for (const win of app.windows()) {
            const url = win.url()
            if (!url.startsWith("devtools://") && (url.startsWith("file://") || url.startsWith("http://"))) {
              page = win
              break
            }
          }
          if (page) break
          await new Promise(r => setTimeout(r, 250))
        }
        if (!page) throw new Error("no app window")
        await page.waitForFunction(() => window.__jetAgent != null, null, { timeout: 30_000 })
        await page.evaluate(async () => {
          await window.__jetAgent!.waitForReady()
        })
      } finally {
        await app.close()
      }
      return Date.now() - t0
    },
  })
  logBenchResult(result)
  assertBudget(result)
})
