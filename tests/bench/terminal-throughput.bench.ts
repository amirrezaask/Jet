import { test } from "@playwright/test"
import { assertBudget, logBenchResult, runBench } from "./_bench.js"
import { hasPtySpawn, launchJet, showTerminal } from "../electron/_launch.js"

const ptyAvailable = hasPtySpawn()

test("bench terminal-stream-throughput", async () => {
  test.skip(!ptyAvailable, "node-pty cannot spawn a shell on this machine")

  const { app, page } = await launchJet()
  try {
    await showTerminal(page)
    await page.waitForFunction(
      () =>
        document.querySelector(
          '[data-gharargah-terminal-panel][data-gharargah-terminal-status="running"]',
        ) != null,
      null,
      { timeout: 15_000 },
    )

    let round = 0
    const result = await runBench({
      name: "terminal-stream-throughput",
      warmup: 1,
      rounds: 5,
      measure: async () => {
        const marker = `GHARARGAH-TERMINAL-BENCH-${round++}`
        return page.evaluate(async currentMarker => {
          const panel = document.querySelector<HTMLElement>(
            '[data-gharargah-terminal-panel][data-gharargah-terminal-status="running"]',
          )
          const ptyId = panel?.dataset.gharargahTerminalPtyId
          const terminal = window.gharargah?.terminal
          if (!ptyId || !terminal) throw new Error("running terminal unavailable")

          const startedAt = performance.now()
          await terminal.write(
            ptyId,
            `head -c 1048576 /dev/zero | tr '\\0' x; printf '\\n${currentMarker}\\n'\n`,
          )
          await new Promise<void>((resolve, reject) => {
            const timeout = window.setTimeout(
              () => reject(new Error(`terminal marker did not paint: ${currentMarker}`)),
              15_000,
            )
            const poll = () => {
              const text = panel.querySelector(".xterm-rows")?.textContent ?? ""
              if (text.includes(currentMarker)) {
                window.clearTimeout(timeout)
                requestAnimationFrame(() => resolve())
                return
              }
              requestAnimationFrame(poll)
            }
            poll()
          })
          return performance.now() - startedAt
        }, marker)
      },
    })
    logBenchResult(result)
    assertBudget(result)
  } finally {
    await app.close()
  }
})
