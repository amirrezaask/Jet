import { expect, test } from "@playwright/test"
import { expectListRows } from "../helpers/list.js"
import {
  execCommand,
  launchJet,
  modChord,
  type ShellDriver,
} from "../electron/_launch.js"
import {
  assertBudget,
  logBenchResult,
  median,
  percentile,
  runBench,
  type BenchResult,
} from "./_bench.js"

const PALETTE = "[data-yaade-palette]"
const PALETTE_INPUT = `${PALETTE} input`
const PALETTE_ROWS =
  '[data-yaade-list-panel="yaade:palette"] [data-yaade-list-item]'
const EDITOR_LINES = "[data-yaade-monaco-editor] .view-lines"

type BrowserFsReadStats = {
  count: number
  bytes: number
  byUri: Record<string, number>
}

type EditorResource = {
  name: string
  initiatorType: string
  transferSize: number
  encodedBodySize: number
  decodedBodySize: number
  duration: number
}

function result(name: string, samples: number[]): BenchResult {
  return {
    name,
    median: median(samples),
    p95: percentile(samples, 0.95),
    p99: percentile(samples, 0.99),
    samples,
  }
}

async function startTimer(page: ShellDriver, name: string): Promise<void> {
  await page.evaluate(mark => {
    performance.clearMarks(mark)
    performance.mark(mark)
  }, name)
}

async function finishTimerAtNextFrame(
  page: ShellDriver,
  name: string,
): Promise<number> {
  return page.evaluate(
    mark =>
      new Promise<number>((resolve, reject) => {
        const started = performance.getEntriesByName(mark, "mark").at(-1)
        if (!started) {
          reject(new Error(`missing benchmark mark: ${mark}`))
          return
        }
        requestAnimationFrame(() => resolve(performance.now() - started.startTime))
      }),
    name,
  )
}

async function installEditorPaintCounter(page: ShellDriver): Promise<void> {
  await page.evaluate(() => {
    const target = document.querySelector("[data-yaade-monaco-editor] .view-lines")
    if (!target) throw new Error("Monaco view lines unavailable")
    const state = {
      paintCount: 0,
      keydownCount: 0,
      lastKey: "",
      lastKeydownAt: 0,
      observer: null as MutationObserver | null,
    }
    state.observer = new MutationObserver(() => {
      state.paintCount += 1
    })
    state.observer.observe(target, {
      childList: true,
      characterData: true,
      subtree: true,
    })
    window.addEventListener(
      "keydown",
      event => {
        const eventTarget = event.target
        if (
          !(eventTarget instanceof Element) ||
          !eventTarget.closest("[data-yaade-monaco-editor]")
        ) {
          return
        }
        state.keydownCount += 1
        state.lastKey = event.key
        state.lastKeydownAt = performance.now()
      },
      true,
    )
    Reflect.set(window, "__yaadeBenchEditorPaints", state)
  })
}

type EditorInputSnapshot = {
  paintCount: number
  keydownCount: number
}

async function editorInputSnapshot(
  page: ShellDriver,
): Promise<EditorInputSnapshot> {
  return page.evaluate(() => {
    const state = Reflect.get(window, "__yaadeBenchEditorPaints")
    if (
      !state ||
      typeof state.paintCount !== "number" ||
      typeof state.keydownCount !== "number"
    ) {
      throw new Error("editor paint counter was not installed")
    }
    return {
      paintCount: state.paintCount as number,
      keydownCount: state.keydownCount as number,
    }
  })
}

async function finishInputAtEditorPaint(
  page: ShellDriver,
  previous: EditorInputSnapshot,
  expectedKey: string,
): Promise<number> {
  return page.evaluate(
    ({ before, key }) =>
      new Promise<number>((resolve, reject) => {
        const deadline = performance.now() + 5_000
        const poll = () => {
          const state = Reflect.get(window, "__yaadeBenchEditorPaints")
          if (
            state &&
            state.keydownCount > before.keydownCount &&
            state.paintCount > before.paintCount &&
            state.lastKey === key
          ) {
            resolve(performance.now() - state.lastKeydownAt)
            return
          }
          if (performance.now() >= deadline) {
            reject(new Error("editor did not paint the typed input"))
            return
          }
          requestAnimationFrame(poll)
        }
        requestAnimationFrame(poll)
      }),
    { before: previous, key: expectedKey },
  )
}

async function installFsReadCounter(page: ShellDriver): Promise<void> {
  await page.evaluate(() => {
    const fs = window.yaade?.fs
    if (!fs) throw new Error("window.yaade.fs unavailable")
    const original = fs.readFile.bind(fs)
    const stats: BrowserFsReadStats = { count: 0, bytes: 0, byUri: {} }
    const countedRead = async (uri: string) => {
      const content = await original(uri)
      stats.count += 1
      stats.bytes += new TextEncoder().encode(content).byteLength
      stats.byUri[uri] = (stats.byUri[uri] ?? 0) + 1
      return content
    }
    Reflect.set(window, "__yaadeBenchFsReads", stats)
    Reflect.set(fs, "readFile", countedRead)
  })
}

async function fsReadStats(page: ShellDriver): Promise<BrowserFsReadStats> {
  return page.evaluate(() => {
    const value = Reflect.get(window, "__yaadeBenchFsReads")
    if (!value || typeof value !== "object") {
      throw new Error("benchmark fs read counter was not installed")
    }
    return structuredClone(value) as BrowserFsReadStats
  })
}

async function waitForPaintedEditorText(
  page: ShellDriver,
  needle: string,
  timeoutMs = 15_000,
): Promise<void> {
  await page.waitForFunction(
    expected =>
      [...document.querySelectorAll<HTMLElement>(
        "[data-yaade-monaco-editor] .view-lines",
      )].some(element => (element.textContent ?? "").includes(expected)),
    needle,
    { timeout: timeoutMs },
  )
}

async function openFileToPaint(
  page: ShellDriver,
  relativePath: string,
  paintedNeedle: string,
  mark: string,
): Promise<number> {
  await startTimer(page, mark)
  await page.evaluate(path => window.__yaadeAgent!.openFile(path), relativePath)
  await waitForPaintedEditorText(page, paintedNeedle)
  return finishTimerAtNextFrame(page, mark)
}

async function closePalette(page: ShellDriver): Promise<void> {
  await page.keyboard.press("Escape")
  await page.locator(PALETTE).waitFor({ state: "hidden", timeout: 10_000 })
}

async function waitForPaletteRows(
  page: ShellDriver,
  needle: string,
  minItems: number,
): Promise<void> {
  await page.waitForFunction(
    ({ selector, expected, minimum }) => {
      const rows = [...document.querySelectorAll<HTMLElement>(selector)].filter(
        row => {
          const rect = row.getBoundingClientRect()
          const style = getComputedStyle(row)
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== "none" &&
            style.visibility !== "hidden"
          )
        },
      )
      return (
        rows.length >= minimum &&
        rows.some(row => (row.textContent ?? "").includes(expected))
      )
    },
    { selector: PALETTE_ROWS, expected: needle, minimum: minItems },
    { timeout: 15_000 },
  )
}

async function editorResources(page: ShellDriver): Promise<EditorResource[]> {
  return page.evaluate(() =>
    (performance.getEntriesByType("resource") as PerformanceResourceTiming[])
      .filter(entry =>
        /(?:MuxEditorPane|MonacoEditorHost|monaco(?:[.-])|(?:editor|css|html|json|ts)\.worker-)/i.test(
          new URL(entry.name).pathname.split("/").at(-1) ?? "",
        ),
      )
      .map(entry => ({
        name: new URL(entry.name).pathname.split("/").at(-1) ?? entry.name,
        initiatorType: entry.initiatorType,
        transferSize: entry.transferSize,
        encodedBodySize: entry.encodedBodySize,
        decodedBodySize: entry.decodedBodySize,
        duration: entry.duration,
      })),
  )
}

test("bench editor cold open, warm switching, lifecycle, and chunks", async () => {
  const coldOpenSamples: number[] = []
  const coldResources: EditorResource[][] = []
  let warmSwitchSamples: number[] = []
  let warmReadDelta = 0

  for (let round = 0; round < 5; round += 1) {
    const { app, page } = await launchJet({ withTerminal: false })
    try {
      await installFsReadCounter(page)
      coldOpenSamples.push(
        await openFileToPaint(
          page,
          "src/index.ts",
          "main()",
          `yaade:bench:open-file:${round}`,
        ),
      )
      coldResources.push(await editorResources(page))

      if (round === 0) {
        const readsBeforeSwitches = (await fsReadStats(page)).count
        for (let switchRound = 0; switchRound < 12; switchRound += 1) {
          const toUtils = switchRound % 2 === 0
          warmSwitchSamples.push(
            await openFileToPaint(
              page,
              toUtils ? "src/utils.ts" : "src/index.ts",
              toUtils ? "Hello" : "main()",
              `yaade:bench:warm-switch:${switchRound}`,
            ),
          )
        }
        warmReadDelta = (await fsReadStats(page)).count - readsBeforeSwitches

        expect(
          await page.locator("[data-yaade-monaco-editor]").count(),
          "tab switches should retain one mounted editor host",
        ).toBe(1)
        expect(
          new Set((await editorResources(page)).map(resource => resource.name))
            .size,
          "tab switches should not reload editor chunks",
        ).toBe(new Set(coldResources[0]!.map(resource => resource.name)).size)
        expect(
          warmReadDelta,
          "each switch must issue at most one file read; caching opportunities are logged",
        ).toBeLessThanOrEqual(12)
      }
    } finally {
      await app.close()
    }
  }

  const coldOpen = result("open-file", coldOpenSamples)
  logBenchResult(coldOpen)
  console.log(
    `[bench] warm-editor-switch median=${median(warmSwitchSamples).toFixed(1)}ms ` +
      `p95=${percentile(warmSwitchSamples, 0.95).toFixed(1)}ms fsReads=${warmReadDelta}/12`,
  )

  const uniqueEditorAssets = new Map<string, EditorResource>()
  for (const resource of coldResources.flat()) {
    uniqueEditorAssets.set(resource.name, resource)
  }
  const rawEditorBytes = [...uniqueEditorAssets.values()].reduce(
    (sum, resource) => sum + resource.decodedBodySize,
    0,
  )
  console.log(
    `[bench] editor-cold-assets count=${uniqueEditorAssets.size} ` +
      `decoded=${rawEditorBytes}B ` +
      `files=${JSON.stringify([...uniqueEditorAssets.keys()].sort())}`,
  )
  expect(
    [...uniqueEditorAssets.keys()].some(name =>
      /^(?:monaco(?:[.-])|MonacoEditorHost-)/i.test(name),
    ),
    "cold editor open should load the lazy Monaco chunk",
  ).toBe(true)
  expect(
    rawEditorBytes,
    "cold editor resources unexpectedly exceed 6 MiB decoded",
  ).toBeLessThan(6 * 1024 * 1024)
  assertBudget(coldOpen)
})

test("bench editor palettes and project navigation", async () => {
  const { app, page } = await launchJet({ withTerminal: false })
  try {
    const palette = await runBench({
      name: "palette-open",
      warmup: 1,
      rounds: 7,
      measure: async () => {
        await startTimer(page, "yaade:bench:palette-open")
        await execCommand(page, "ui.showCommandPalette")
        await waitForPaletteRows(page, "Quick Open File", 3)
        const elapsed = await finishTimerAtNextFrame(
          page,
          "yaade:bench:palette-open",
        )
        await closePalette(page)
        return elapsed
      },
    })
    logBenchResult(palette)
    assertBudget(palette)

    await execCommand(page, "ui.showCommandPalette")
    await waitForPaletteRows(page, "Quick Open File", 3)
    await expectListRows(page, {
      panel: "yaade:palette",
      minItems: 3,
      needle: "Quick Open File",
      noResultsText: "No results.",
    })
    await closePalette(page)

    const quickOpen = await runBench({
      name: "quick-open",
      warmup: 1,
      rounds: 7,
      measure: async () => {
        await startTimer(page, "yaade:bench:quick-open")
        await execCommand(page, "editor.quickOpen")
        await page.locator(PALETTE_INPUT).first().fill("index.ts")
        await waitForPaletteRows(page, "src/index.ts", 1)
        const elapsed = await finishTimerAtNextFrame(
          page,
          "yaade:bench:quick-open",
        )
        await closePalette(page)
        return elapsed
      },
    })
    logBenchResult(quickOpen)
    assertBudget(quickOpen)

    await execCommand(page, "editor.quickOpen")
    await page.locator(PALETTE_INPUT).first().fill("index.ts")
    await waitForPaletteRows(page, "src/index.ts", 1)
    await expectListRows(page, {
      panel: "yaade:palette",
      minItems: 1,
      needle: "src/index.ts",
      noResultsText: "No matching files.",
    })
    await closePalette(page)

    const projectSearch = await runBench({
      name: "project-search",
      warmup: 1,
      rounds: 7,
      measure: async () => {
        await startTimer(page, "yaade:bench:project-search")
        await execCommand(page, "editor.projectSearch")
        await page.locator(PALETTE_INPUT).first().fill("greet")
        await waitForPaletteRows(page, "src/index.ts:", 2)
        const elapsed = await finishTimerAtNextFrame(
          page,
          "yaade:bench:project-search",
        )
        await closePalette(page)
        return elapsed
      },
    })
    logBenchResult(projectSearch)
    assertBudget(projectSearch)

    await execCommand(page, "editor.projectSearch")
    await page.locator(PALETTE_INPUT).first().fill("greet")
    await waitForPaletteRows(page, "src/index.ts:", 2)
    await expectListRows(page, {
      panel: "yaade:palette",
      minItems: 2,
      needle: "src/index.ts:",
      noResultsText: "No matches.",
    })
    await closePalette(page)
  } finally {
    await app.close()
  }
})

test("bench large-model typing and scroll next paint", async () => {
  const { app, page } = await launchJet({ withTerminal: false })
  try {
    const largeFile = ".yaade-editor-bench.ts"
    await page.evaluate(async relativePath => {
      const root = window.__yaadeAgent!.getState().workspace
      if (!root) throw new Error("workspace unavailable")
      const uri = encodeURI(`file://${root}/${relativePath}`)
      const content = Array.from(
        { length: 5_000 },
        (_, index) => `export const value${index} = ${index}\n`,
      ).join("")
      await window.yaade!.fs.writeFile(uri, content)
    }, largeFile)
    await openFileToPaint(
      page,
      largeFile,
      "value0",
      "yaade:bench:large-file-open",
    )

    const input = page.locator(
      "[data-yaade-monaco-editor] textarea.inputarea",
    )
    await input.focus()
    await page.keyboard.press(`${modChord()}+ArrowDown`)
    await page.evaluate(
      () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    )
    await installEditorPaintCounter(page)

    const typing = await runBench({
      name: "typing-latency",
      warmup: 3,
      rounds: 60,
      measure: async () => {
        await input.focus()
        const previous = await editorInputSnapshot(page)
        await page.keyboard.type("x")
        return finishInputAtEditorPaint(page, previous, "x")
      },
    })
    logBenchResult(typing)
    expect(await page.textContent(EDITOR_LINES)).toContain("x")

    await input.focus()
    await page.keyboard.press(`${modChord()}+ArrowUp`)
    await page.waitForTimeout(50)

    const scroll = await runBench({
      name: "scroll-next-paint",
      warmup: 3,
      rounds: 60,
      measure: async () => {
        await input.focus()
        const previous = await editorInputSnapshot(page)
        await page.keyboard.press("PageDown")
        return finishInputAtEditorPaint(page, previous, "PageDown")
      },
    })
    logBenchResult(scroll)
    assertBudget(typing)
    assertBudget(scroll)
  } finally {
    await app.close()
  }
})
