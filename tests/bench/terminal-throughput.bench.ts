import { test, expect } from "@playwright/test"
import { assertBudget, logBenchResult, runBench } from "./_bench.js"
import {
  focusTerminal,
  hasPtySpawn,
  launchJet,
  showTerminal,
} from "../electron/_launch.js"

const ptyAvailable = hasPtySpawn()

async function waitForRunningTerminal(page: import("@playwright/test").Page): Promise<void> {
  await page.waitForFunction(
    () =>
      document.querySelector(
        '[data-gharargah-terminal-panel][data-gharargah-terminal-status="running"]',
      ) != null,
    null,
    { timeout: 15_000 },
  )
}

test("bench terminal-stream-throughput", async () => {
  test.skip(!ptyAvailable, "node-pty cannot spawn a shell on this machine")

  const { app, page } = await launchJet()
  try {
    await showTerminal(page)
    await waitForRunningTerminal(page)

    let round = 0
    const result = await runBench({
      name: "terminal-stream-throughput",
      warmup: 2,
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
              30_000,
            )
            const poll = () => {
              const text = window.__gharargahAgent?.getTerminalText?.() ?? ""
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

/**
 * Agent/TUI-like flood: many small CSI + CR rewrite frames (not one fat blob).
 * Exercises rAF coalesce + GPU renderer under Cursor-style paint storms.
 */
test("bench terminal-agent-flood-throughput", async () => {
  test.skip(!ptyAvailable, "node-pty cannot spawn a shell on this machine")

  const { app, page } = await launchJet()
  try {
    await showTerminal(page)
    await waitForRunningTerminal(page)

    let round = 0
    const result = await runBench({
      name: "terminal-agent-flood-throughput",
      warmup: 2,
      rounds: 5,
      measure: async () => {
        const marker = `GHARARGAH-AGENT-FLOOD-${round++}`
        return page.evaluate(async currentMarker => {
          const panel = document.querySelector<HTMLElement>(
            '[data-gharargah-terminal-panel][data-gharargah-terminal-status="running"]',
          )
          const ptyId = panel?.dataset.gharargahTerminalPtyId
          const terminal = window.gharargah?.terminal
          if (!ptyId || !terminal) throw new Error("running terminal unavailable")

          // Generate the flood in the PTY so host batching matches real agent CLIs
          // (many small onData chunks), not one giant RPC write.
          const script = [
            "python3 - <<'PY'",
            "import sys",
            "for i in range(2000):",
            "    hide = i % 2 == 0",
            "    sys.stdout.write(('\\x1b[?25l' if hide else '\\x1b[?25h') + f'\\rprogress {i}/2000   ')",
            "    if i % 16 == 0:",
            "        sys.stdout.flush()",
            "sys.stdout.write('\\r\\n' + " + JSON.stringify(currentMarker) + " + '\\n')",
            "sys.stdout.flush()",
            "PY",
            "",
          ].join("\n")

          const startedAt = performance.now()
          await terminal.write(ptyId, script)
          await new Promise<void>((resolve, reject) => {
            const timeout = window.setTimeout(
              () => reject(new Error(`agent flood marker did not paint: ${currentMarker}`)),
              30_000,
            )
            const poll = () => {
              const text = window.__gharargahAgent?.getTerminalText?.() ?? ""
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

/**
 * Idle key → echo paint. Target ≤1 frame (16ms median) — VS Code local feel.
 */
test("bench terminal-typing-idle", async () => {
  test.skip(!ptyAvailable, "node-pty cannot spawn a shell on this machine")

  const { app, page } = await launchJet()
  try {
    await showTerminal(page)
    await waitForRunningTerminal(page)

    await focusTerminal(page)

    let idleRound = 0
    const result = await runBench({
      name: "terminal-typing-idle",
      warmup: 2,
      rounds: 8,
      measure: async () => {
        await focusTerminal(page)
        // Unique needle — shell redraw can keep total string length stable.
        const marker = `Id${idleRound++}z`
        const t0 = await page.evaluate(() => performance.now())
        await page.keyboard.type(marker, { delay: 0 })
        await page.waitForFunction(
          needle =>
            (window.__gharargahAgent?.getTerminalText?.() ?? "").includes(needle),
          marker,
          { timeout: 10_000 },
        )
        const t1 = await page.evaluate(
          () =>
            new Promise<number>(resolve => {
              requestAnimationFrame(() => resolve(performance.now()))
            }),
        )
        // Per-key estimate: total / chars typed (marker length).
        return (t1 - t0) / marker.length
      },
    })
    logBenchResult(result)
    assertBudget(result)
  } finally {
    await app.close()
  }
})

/**
 * Typing latency while a Cursor-style TUI flood is in flight.
 * Throughput benches can look fine while the main thread still stalls on
 * giant term.write calls — this is the user-visible lag metric.
 */
test("bench terminal-typing-under-flood", async () => {
  test.skip(!ptyAvailable, "node-pty cannot spawn a shell on this machine")

  const { app, page } = await launchJet()
  try {
    await showTerminal(page)
    await waitForRunningTerminal(page)

    const renderer = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>(
        "[data-gharargah-terminal-panel]",
      )
      return panel?.dataset.gharargahTerminalRenderer ?? "unknown"
    })
    // Prefer GPU; Dom is acceptable in headless CI without WebGL.
    expect(["webgl", "canvas", "dom"]).toContain(renderer)

    const result = await runBench({
      name: "terminal-typing-under-flood",
      warmup: 1,
      rounds: 5,
      measure: async () => {
        return page.evaluate(async () => {
          const panel = document.querySelector<HTMLElement>(
            '[data-gharargah-terminal-panel][data-gharargah-terminal-status="running"]',
          )
          const ptyId = panel?.dataset.gharargahTerminalPtyId
          const terminal = window.gharargah?.terminal
          const textarea = panel?.querySelector<HTMLTextAreaElement>(
            ".xterm-helper-textarea",
          )
          if (!ptyId || !terminal || !textarea) {
            throw new Error("running terminal input unavailable")
          }

          // Continuous agent-like CR rewrite flood for ~1.2s.
          const flood = [
            "python3 - <<'PY'",
            "import sys, time",
            "end = time.time() + 1.2",
            "i = 0",
            "while time.time() < end:",
            "    hide = i % 2 == 0",
            "    sys.stdout.write(('\\x1b[?25l' if hide else '\\x1b[?25h') + f'\\rprogress {i}   ')",
            "    if i % 8 == 0:",
            "        sys.stdout.flush()",
            "    i += 1",
            "sys.stdout.write('\\r\\n')",
            "sys.stdout.flush()",
            "PY",
            "",
          ].join("\n")
          await terminal.write(ptyId, flood)

          // Let flood hit the renderer before measuring key latency.
          await new Promise<void>(r => setTimeout(r, 80))

          textarea.focus()
          const samples: number[] = []
          const phases: Array<{ keyToRaf2: number }> = []
          for (let n = 0; n < 8; n++) {
            const t0 = performance.now()
            textarea.dispatchEvent(
              new InputEvent("beforeinput", {
                bubbles: true,
                cancelable: true,
                inputType: "insertText",
                data: "x",
              }),
            )
            // Fallback path used by xterm for synthetic tests.
            textarea.value = "x"
            textarea.dispatchEvent(
              new InputEvent("input", { bubbles: true, data: "x" }),
            )
            await new Promise<void>(resolve => {
              requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
            })
            const keyToRaf2 = performance.now() - t0
            samples.push(keyToRaf2)
            phases.push({ keyToRaf2 })
            await new Promise<void>(r => setTimeout(r, 16))
          }

          samples.sort((a, b) => a - b)
          const p95 =
            samples[
              Math.min(samples.length - 1, Math.ceil(samples.length * 0.95) - 1)
            ]!
          // Diagnostic: key→2-rAF under flood (input WS + echo path).
          console.log(
            "[bench] terminal-typing-under-flood phases",
            JSON.stringify(phases.map(p => Math.round(p.keyToRaf2))),
          )
          return p95
        })
      },
    })
    logBenchResult(result)
    assertBudget(result)
  } finally {
    await app.close()
  }
})
