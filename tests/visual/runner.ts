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
    }
  }
}
