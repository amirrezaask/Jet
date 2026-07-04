#!/usr/bin/env tsx
import { readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve, isAbsolute, basename } from "node:path"
import { chromium, type Browser, type Page } from "@playwright/test"

type WaitStep = { wait: { frames?: number; ms?: number; animations_idle?: boolean } }
type Step =
  | { wait_frames: number }
  | WaitStep
  | { key: string }
  | { text: string }
  | { command: string; args?: Record<string, unknown> }
  | { screenshot: string }
  | { a11y_snapshot: string; selector?: string }
  | { dom_dump: string; selector?: string }
  | { open_workspace: string }
  | { open_file: string }
  | { assert_state: Partial<Record<string, unknown>> }
  | { assert_a11y_contains: string | string[]; selector?: string }
  | { assert_a11y_not_contains: string | string[]; selector?: string }
  | {
      assert_layout: {
        selector?: string
        min_items?: number
        min_unique_tops?: number
        min_row_height?: number
      }
    }
  | {
      assert_no_overlap: {
        selector?: string
        min_items?: number
        tolerance_px?: number
      }
    }
  | {
      assert_no_clipping: {
        selector?: string
        container_selector?: string
      }
    }
  | {
      assert_row_spacing: {
        selector?: string
        min_items?: number
        max_gap_px?: number
        tolerance_px?: number
      }
    }
  | { click_selector: string; nth?: number }
  | { right_click_selector: string; nth?: number }
  | { hover_selector: string; nth?: number }
  | { wheel_scroll: { selector?: string; delta_y?: number; delta_x?: number } }
  | {
      assert_element_width: {
        selector: string
        min_px?: number
        max_px?: number
        min_pct_of_viewport?: number
        max_pct_of_viewport?: number
      }
    }
  | {
      drag_resize_handle: {
        selector?: string
        delta_x?: number
        delta_y?: number
      }
    }
  | {
      assert_syntax_highlighting: {
        selector?: string
        min_colored_spans?: number
        min_unique_colors?: number
        require_keyword_color?: boolean
      }
    }
  | { exit: number }

type Scenario = {
  window?: { width?: number; height?: number; theme?: string; font_size?: number }
  base_url?: string
  workspace?: string
  files?: string[]
  steps: Step[]
}

type ResultJson = {
  scenario: string
  screenshots: string[]
  a11y_snapshots: string[]
  dom_dumps: string[]
  frames: number
  exit: number
  error?: string
}

const FRAME_MS = 16
const DEFAULT_BASE_URL = process.env.JET_BASE_URL ?? "http://localhost:5174"
const REPO_ROOT = resolve(new URL("../..", import.meta.url).pathname)

function usage(): never {
  process.stderr.write("usage: runner.ts --scenario <path.json>\n")
  process.exit(2)
}

function parseArgs(argv: string[]): { scenario: string } {
  let scenario = ""
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--scenario") scenario = argv[++i] ?? ""
  }
  if (!scenario) usage()
  return { scenario: isAbsolute(scenario) ? scenario : resolve(process.cwd(), scenario) }
}

function loadScenario(path: string): Scenario {
  const raw = readFileSync(path, "utf8")
  return JSON.parse(raw) as Scenario
}

function resolveOutputPath(p: string): string {
  return isAbsolute(p) ? p : resolve(REPO_ROOT, p)
}

async function waitAnimationsIdle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>(resolve => {
        const anims = document.getAnimations?.() ?? []
        if (anims.length === 0) {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          return
        }
        Promise.allSettled(anims.map(a => a.finished)).then(() =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        )
      }),
  )
}

async function captureAriaSnapshot(page: Page, selector: string | undefined): Promise<string> {
  const loc = page.locator(selector ?? "body")
  return await loc.ariaSnapshot()
}

function a11yContainsAll(snap: string, needles: string[]): { ok: true } | { ok: false; missing: string } {
  const haystack = snap.toLowerCase()
  for (const n of needles) {
    if (!haystack.includes(n.toLowerCase())) return { ok: false, missing: n }
  }
  return { ok: true }
}

async function runStep(
  page: Page,
  step: Step,
  ctx: {
    screenshots: string[]
    a11ySnapshots: string[]
    domDumps: string[]
    frames: { n: number }
    scenario: Scenario
  },
): Promise<{ exit?: number }> {
  if ("wait_frames" in step) {
    ctx.frames.n += step.wait_frames
    await page.waitForTimeout(step.wait_frames * FRAME_MS)
    return {}
  }
  if ("wait" in step) {
    const w = step.wait
    if (w.frames) {
      ctx.frames.n += w.frames
      await page.waitForTimeout(w.frames * FRAME_MS)
    }
    if (w.ms) await page.waitForTimeout(w.ms)
    if (w.animations_idle) await waitAnimationsIdle(page)
    return {}
  }
  if ("key" in step) {
    await page.keyboard.press(step.key)
    return {}
  }
  if ("text" in step) {
    await page.keyboard.type(step.text)
    return {}
  }
  if ("command" in step) {
    await page.evaluate(
      async ({ id }) => {
        if (!window.__jetAgent) throw new Error("__jetAgent not present")
        await window.__jetAgent.executeCommand(id)
      },
      { id: step.command },
    )
    return {}
  }
  if ("open_workspace" in step) {
    await page.evaluate(
      async ({ p }) => {
        if (!window.__jetAgent) throw new Error("__jetAgent not present")
        await window.__jetAgent.openWorkspace(p)
      },
      { p: step.open_workspace },
    )
    return {}
  }
  if ("open_file" in step) {
    await page.evaluate(
      async ({ f }) => {
        if (!window.__jetAgent) throw new Error("__jetAgent not present")
        await window.__jetAgent.openFile(f)
      },
      { f: step.open_file },
    )
    return {}
  }
  if ("screenshot" in step) {
    const out = resolveOutputPath(step.screenshot)
    mkdirSync(dirname(out), { recursive: true })
    await page.screenshot({ path: out, fullPage: false })
    ctx.screenshots.push(out)
    return {}
  }
  if ("a11y_snapshot" in step) {
    const out = resolveOutputPath(step.a11y_snapshot)
    mkdirSync(dirname(out), { recursive: true })
    const snap = await captureAriaSnapshot(page, step.selector)
    writeFileSync(out, snap)
    ctx.a11ySnapshots.push(out)
    return {}
  }
  if ("dom_dump" in step) {
    const out = resolveOutputPath(step.dom_dump)
    mkdirSync(dirname(out), { recursive: true })
    const html = await page.evaluate(
      ({ sel }) => {
        const el = sel ? document.querySelector(sel) : document.body
        return el ? (el as HTMLElement).outerHTML : ""
      },
      { sel: step.selector ?? null },
    )
    writeFileSync(out, html)
    ctx.domDumps.push(out)
    return {}
  }
  if ("assert_a11y_contains" in step) {
    const needles = Array.isArray(step.assert_a11y_contains)
      ? step.assert_a11y_contains
      : [step.assert_a11y_contains]
    const snap = await captureAriaSnapshot(page, step.selector)
    const r = a11yContainsAll(snap, needles)
    if (r.ok === false) {
      throw new Error(`assert_a11y_contains failed: missing="${r.missing}"`)
    }
    return {}
  }
  if ("assert_layout" in step) {
    const cfg = step.assert_layout
    const sel = cfg.selector ?? "[data-jet-list-item]"
    const minItems = cfg.min_items ?? 2
    const minUniqueTops = cfg.min_unique_tops ?? minItems
    const minRowHeight = cfg.min_row_height ?? 18
    const layout = await page.evaluate(
      ({ sel, minItems, minUniqueTops, minRowHeight }) => {
        const items = [...document.querySelectorAll<HTMLElement>(sel)]
        const rects = items.map(el => el.getBoundingClientRect())
        const tops = rects.map(r => Math.round(r.top))
        const uniqueTops = new Set(tops).size
        const minH = rects.length ? Math.min(...rects.map(r => r.height)) : 0
        const flexShrinks = items.slice(0, 5).map(el => getComputedStyle(el).flexShrink)
        return { count: items.length, uniqueTops, minH, tops: tops.slice(0, 8), flexShrinks }
      },
      { sel, minItems, minUniqueTops, minRowHeight },
    )
    if (layout.count < minItems) {
      throw new Error(`assert_layout failed: count=${layout.count} expected>=${minItems}`)
    }
    if (layout.uniqueTops < minUniqueTops) {
      throw new Error(
        `assert_layout failed: uniqueTops=${layout.uniqueTops} expected>=${minUniqueTops} tops=${JSON.stringify(layout.tops)}`,
      )
    }
    if (layout.minH < minRowHeight) {
      throw new Error(`assert_layout failed: minRowHeight=${layout.minH} expected>=${minRowHeight}`)
    }
    if (layout.flexShrinks.some(s => s !== "0")) {
      throw new Error(`assert_layout failed: flexShrink must be 0, got ${JSON.stringify(layout.flexShrinks)}`)
    }
    return {}
  }
  if ("assert_no_overlap" in step) {
    const cfg = step.assert_no_overlap
    const sel = cfg.selector ?? "[data-jet-list-item]"
    const minItems = cfg.min_items ?? 2
    const tol = cfg.tolerance_px ?? 0
    const report = await page.evaluate(
      ({ sel, tol }) => {
        const items = [...document.querySelectorAll<HTMLElement>(sel)]
        const rects = items.map((el, i) => {
          const r = el.getBoundingClientRect()
          return {
            i,
            top: r.top,
            bottom: r.bottom,
            left: r.left,
            right: r.right,
            text: (el.textContent ?? "").trim().slice(0, 40),
          }
        })
        const overlaps: Array<{ a: number; b: number; aText: string; bText: string; overlapY: number }> = []
        for (let i = 0; i < rects.length; i++) {
          for (let j = i + 1; j < rects.length; j++) {
            const a = rects[i]
            const b = rects[j]
            const yOverlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
            const xOverlap = Math.min(a.right, b.right) - Math.max(a.left, b.left)
            if (yOverlap > tol && xOverlap > tol) {
              overlaps.push({ a: a.i, b: b.i, aText: a.text, bText: b.text, overlapY: yOverlap })
            }
          }
        }
        return { count: rects.length, overlaps: overlaps.slice(0, 5), totalOverlaps: overlaps.length }
      },
      { sel, tol },
    )
    if (report.count < minItems) {
      throw new Error(`assert_no_overlap: found ${report.count} items, expected >= ${minItems}`)
    }
    if (report.totalOverlaps > 0) {
      throw new Error(
        `assert_no_overlap failed: ${report.totalOverlaps} overlapping pair(s). Examples: ${JSON.stringify(report.overlaps)}`,
      )
    }
    return {}
  }
  if ("assert_no_clipping" in step) {
    const cfg = step.assert_no_clipping
    const sel = cfg.selector ?? "[data-jet-list-item]"
    const containerSel = cfg.container_selector
    const report = await page.evaluate(
      ({ sel, containerSel }) => {
        const items = [...document.querySelectorAll<HTMLElement>(sel)]
        const container = containerSel ? document.querySelector<HTMLElement>(containerSel) : null
        const containerRect = container?.getBoundingClientRect() ?? null
        const clipped: Array<{ i: number; text: string; scrollW: number; clientW: number }> = []
        items.forEach((el, i) => {
          const scrollW = el.scrollWidth
          const clientW = el.clientWidth
          if (scrollW - clientW > 1 && getComputedStyle(el).textOverflow !== "ellipsis") {
            const truncEl = el.querySelector<HTMLElement>(".truncate, [data-truncate]")
            const trunc = truncEl && getComputedStyle(truncEl).textOverflow === "ellipsis"
            if (!trunc) {
              clipped.push({ i, text: (el.textContent ?? "").trim().slice(0, 40), scrollW, clientW })
            }
          }
          if (containerRect) {
            const r = el.getBoundingClientRect()
            if (r.right > containerRect.right + 1 || r.bottom > containerRect.bottom + 1) {
              clipped.push({ i, text: (el.textContent ?? "").trim().slice(0, 40), scrollW, clientW })
            }
          }
        })
        return { count: items.length, clipped: clipped.slice(0, 5), total: clipped.length }
      },
      { sel, containerSel: containerSel ?? null },
    )
    if (report.total > 0) {
      throw new Error(
        `assert_no_clipping failed: ${report.total} clipped element(s). Examples: ${JSON.stringify(report.clipped)}`,
      )
    }
    return {}
  }
  if ("assert_row_spacing" in step) {
    const cfg = step.assert_row_spacing
    const sel = cfg.selector ?? "[data-jet-list-item]"
    const minItems = cfg.min_items ?? 2
    const maxGap = cfg.max_gap_px ?? 2
    const tol = cfg.tolerance_px ?? 0.5
    const report = await page.evaluate(
      ({ sel, maxGap, tol }) => {
        const items = [...document.querySelectorAll<HTMLElement>(sel)]
        const rects = items
          .map((el, i) => {
            const r = el.getBoundingClientRect()
            return {
              i,
              top: r.top,
              bottom: r.bottom,
              text: (el.textContent ?? "").trim().slice(0, 40),
            }
          })
          .sort((a, b) => a.top - b.top || a.i - b.i)
        const badGaps: Array<{ a: number; b: number; gap: number; aText: string; bText: string }> = []
        for (let j = 1; j < rects.length; j++) {
          const gap = rects[j].top - rects[j - 1].bottom
          if (gap > maxGap + tol) {
            badGaps.push({
              a: rects[j - 1].i,
              b: rects[j].i,
              gap: Math.round(gap * 10) / 10,
              aText: rects[j - 1].text,
              bText: rects[j].text,
            })
          }
        }
        return { count: rects.length, badGaps: badGaps.slice(0, 5), totalBad: badGaps.length }
      },
      { sel, maxGap, tol },
    )
    if (report.count < minItems) {
      throw new Error(`assert_row_spacing: found ${report.count} items, expected >= ${minItems}`)
    }
    if (report.totalBad > 0) {
      throw new Error(
        `assert_row_spacing failed: ${report.totalBad} gap(s) exceed ${maxGap}px. Examples: ${JSON.stringify(report.badGaps)}`,
      )
    }
    return {}
  }
  if ("click_selector" in step) {
    const nth = step.nth ?? 0
    await page.locator(step.click_selector).nth(nth).click()
    return {}
  }
  if ("right_click_selector" in step) {
    const nth = step.nth ?? 0
    await page.locator(step.right_click_selector).nth(nth).click({ button: "right" })
    return {}
  }
  if ("hover_selector" in step) {
    const nth = step.nth ?? 0
    await page.locator(step.hover_selector).nth(nth).hover()
    return {}
  }
  if ("wheel_scroll" in step) {
    const { selector, delta_y = 0, delta_x = 0 } = step.wheel_scroll
    await page.evaluate(
      ({ selector, dy, dx }) => {
        const el = selector ? document.querySelector<HTMLElement>(selector) : document.scrollingElement
        if (!el) throw new Error(`wheel_scroll: no element matches ${selector}`)
        ;(el as HTMLElement).scrollBy({ left: dx, top: dy, behavior: "instant" as ScrollBehavior })
      },
      { selector: selector ?? null, dy: delta_y, dx: delta_x },
    )
    return {}
  }
  if ("assert_element_width" in step) {
    const cfg = step.assert_element_width
    const report = await page.evaluate(
      ({ sel }) => {
        const el = document.querySelector<HTMLElement>(sel)
        if (!el) return { found: false as const }
        const width = el.getBoundingClientRect().width
        return { found: true as const, width, viewport: window.innerWidth }
      },
      { sel: cfg.selector },
    )
    if (!report.found) {
      throw new Error(`assert_element_width: no element matches ${cfg.selector}`)
    }
    const { width, viewport } = report
    if (cfg.min_px != null && width < cfg.min_px) {
      throw new Error(`assert_element_width failed: width=${width}px expected>=${cfg.min_px}px`)
    }
    if (cfg.max_px != null && width > cfg.max_px) {
      throw new Error(`assert_element_width failed: width=${width}px expected<=${cfg.max_px}px`)
    }
    const pct = (width / viewport) * 100
    if (cfg.min_pct_of_viewport != null && pct < cfg.min_pct_of_viewport) {
      throw new Error(
        `assert_element_width failed: width=${width}px (${pct.toFixed(1)}% vw) expected>=${cfg.min_pct_of_viewport}%`,
      )
    }
    if (cfg.max_pct_of_viewport != null && pct > cfg.max_pct_of_viewport) {
      throw new Error(
        `assert_element_width failed: width=${width}px (${pct.toFixed(1)}% vw) expected<=${cfg.max_pct_of_viewport}%`,
      )
    }
    return {}
  }
  if ("drag_resize_handle" in step) {
    const sel = step.drag_resize_handle.selector ?? "[data-jet-workspace-split-handle]"
    const deltaX = step.drag_resize_handle.delta_x ?? 0
    const deltaY = step.drag_resize_handle.delta_y ?? 0
    const handle = page.locator(sel).first()
    const box = await handle.boundingBox()
    if (!box) throw new Error(`drag_resize_handle: no bounding box for ${sel}`)
    const startX = box.x + box.width / 2
    const startY = box.y + box.height / 2
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 12 })
    await page.mouse.up()
    await waitAnimationsIdle(page)
    return {}
  }
  if ("assert_syntax_highlighting" in step) {
    const cfg = step.assert_syntax_highlighting
    const sel = cfg.selector ?? ".cm-line span"
    const minSpans = cfg.min_colored_spans ?? 5
    const minColors = cfg.min_unique_colors ?? 3
    const report = await page.evaluate(
      ({ sel }) => {
        const spans = [...document.querySelectorAll<HTMLElement>(sel)]
        const colored = spans.filter(s => {
          const c = getComputedStyle(s).color
          return c && c !== "rgba(0, 0, 0, 0)"
        })
        const colors = [...new Set(colored.map(s => getComputedStyle(s).color))]
        const keywords = colored.filter(s => /^(import|export|function|const|let|return|fn|pub|enum|struct)\b/.test(s.textContent ?? ""))
        const keywordColors = [...new Set(keywords.map(s => getComputedStyle(s).color))]
        return {
          spanCount: spans.length,
          coloredCount: colored.length,
          uniqueColors: colors.length,
          keywordCount: keywords.length,
          keywordUniqueColors: keywordColors.length,
          sampleColors: colors.slice(0, 6),
        }
      },
      { sel },
    )
    if (report.spanCount < minSpans) {
      throw new Error(`assert_syntax_highlighting: spanCount=${report.spanCount} expected>=${minSpans}`)
    }
    if (report.coloredCount < minSpans) {
      throw new Error(`assert_syntax_highlighting: coloredCount=${report.coloredCount} expected>=${minSpans}`)
    }
    if (report.uniqueColors < minColors) {
      throw new Error(
        `assert_syntax_highlighting: uniqueColors=${report.uniqueColors} expected>=${minColors} sample=${JSON.stringify(report.sampleColors)}`,
      )
    }
    if (cfg.require_keyword_color && report.keywordCount > 0 && report.keywordUniqueColors < 1) {
      throw new Error("assert_syntax_highlighting: keyword tokens have no distinct color")
    }
    return {}
  }
  if ("assert_a11y_not_contains" in step) {
    const needles = Array.isArray(step.assert_a11y_not_contains)
      ? step.assert_a11y_not_contains
      : [step.assert_a11y_not_contains]
    const snap = await captureAriaSnapshot(page, step.selector)
    const haystack = snap.toLowerCase()
    for (const n of needles) {
      if (haystack.includes(n.toLowerCase())) {
        throw new Error(`assert_a11y_not_contains failed: found="${n}"`)
      }
    }
    return {}
  }
  if ("assert_state" in step) {
    const state = await page.evaluate(() => window.__jetAgent!.getState())
    for (const [k, expected] of Object.entries(step.assert_state)) {
      const actual = (state as Record<string, unknown>)[k]
      const eq = JSON.stringify(actual) === JSON.stringify(expected)
      if (!eq) {
        throw new Error(
          `assert_state failed: ${k} expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`,
        )
      }
    }
    return {}
  }
  if ("exit" in step) {
    return { exit: step.exit }
  }
  throw new Error(`unknown step: ${JSON.stringify(step)}`)
}

async function run(scenarioPath: string): Promise<ResultJson> {
  const scenario = loadScenario(scenarioPath)
  const width = scenario.window?.width ?? 1280
  const height = scenario.window?.height ?? 800
  const baseUrl = scenario.base_url ?? DEFAULT_BASE_URL

  const params = new URLSearchParams()
  if (scenario.workspace) params.set("workspace", scenario.workspace)
  const firstFile = scenario.files?.[0]
  if (firstFile) params.set("file", firstFile)
  const url = params.toString() ? `${baseUrl}/?${params}` : baseUrl

  const result: ResultJson = {
    scenario: basename(scenarioPath),
    screenshots: [],
    a11y_snapshots: [],
    dom_dumps: [],
    frames: 0,
    exit: 0,
  }

  let browser: Browser | null = null
  try {
    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({ viewport: { width, height } })
    if (scenario.window?.font_size != null) {
      const px = scenario.window.font_size
      await context.addInitScript(size => {
        localStorage.setItem("jet-font-size", String(size))
      }, px)
    }
    const page = await context.newPage()
    page.on("pageerror", err => {
      process.stderr.write(`[pageerror] ${err.message}\n`)
    })
    await page.goto(url)
    await page.waitForFunction(() => window.__jetAgent != null, null, { timeout: 30_000 })
    await page.evaluate(async () => {
      await window.__jetAgent!.waitForReady()
      if (window.__jetAgent!.getState().workspace) {
        await window.__jetAgent!.waitForEditor().catch(() => {})
      }
    })

    if (scenario.window?.font_size != null) {
      const px = scenario.window.font_size
      await page.evaluate(size => window.__jetAgent!.setFontSize(size), px)
    }

    const openExtras = scenario.files?.slice(1) ?? []
    for (const f of openExtras) {
      await page.evaluate(
        async ({ f }) => window.__jetAgent!.openFile(f),
        { f },
      )
    }

    const ctx = {
      screenshots: result.screenshots,
      a11ySnapshots: result.a11y_snapshots,
      domDumps: result.dom_dumps,
      frames: { n: 0 },
      scenario,
    }
    for (const step of scenario.steps) {
      const r = await runStep(page, step, ctx)
      if (r.exit !== undefined) {
        result.exit = r.exit
        break
      }
    }
    result.frames = ctx.frames.n
  } catch (err) {
    result.exit = 1
    result.error = err instanceof Error ? err.message : String(err)
  } finally {
    await browser?.close().catch(() => {})
  }
  return result
}

const { scenario } = parseArgs(process.argv.slice(2))
run(scenario).then(res => {
  process.stdout.write(JSON.stringify(res) + "\n")
  process.exit(res.exit)
})

declare global {
  interface Window {
    __jetAgent?: {
      openWorkspace(p: string): Promise<void>
      openFile(f: string): Promise<void>
      executeCommand(id: string): Promise<void>
      getState(): Record<string, unknown>
      waitForReady(): Promise<void>
      waitForEditor(timeoutMs?: number): Promise<void>
      setFontSize(px: number): void
    }
  }
}
