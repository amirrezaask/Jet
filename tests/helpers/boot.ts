import { expect, type Page } from "@playwright/test"
import { agent } from "./agent.js"

const BASE_URL = process.env.JET_BASE_URL ?? "http://localhost:5174"

export type BootOpts = {
  workspace?: string
  file?: string
  extraFiles?: string[]
  fontSize?: number
  width?: number
  height?: number
  query?: Record<string, string>
}

export async function boot(page: Page, opts: BootOpts = {}): Promise<void> {
  const { workspace, file, extraFiles = [], fontSize, query = {} } = opts

  // Set font size via localStorage before page load if needed
  if (fontSize != null) {
    await page.addInitScript((size: number) => {
      localStorage.setItem("jet-font-size", String(size))
    }, fontSize)
  }

  const params = new URLSearchParams(query)
  if (workspace) params.set("workspace", workspace)
  if (file) params.set("file", file)
  const url = params.toString() ? `${BASE_URL}/?${params}` : BASE_URL

  await page.goto(url)
  await page.waitForFunction(() => window.__jetAgent != null, null, { timeout: 30_000 })
  const a = agent(page)
  await a.waitForReady()

  if (workspace) {
    await a.waitForEditor().catch(() => {})
    if (file) {
      const needle = file.endsWith(".json") ? '"name"' : "export function"
      await expect
        .poll(async () => (await a.getEditorText())?.includes(needle) ?? false, { timeout: 15_000 })
        .toBe(true)
    }
  }

  if (fontSize != null) {
    await a.setFontSize(fontSize)
  }

  for (const f of extraFiles) {
    await a.openFile(f)
  }
}

export async function bootWithWorkspace(page: Page, workspace: string, file: string): Promise<void> {
  return boot(page, { workspace, file })
}

export async function waitAnimationsIdle(page: Page): Promise<void> {
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

export const SAMPLE = "fixtures/sample-workspace"
export const REPO = "."
