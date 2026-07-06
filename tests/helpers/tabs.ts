import { expect, type Page } from "@playwright/test"
import { agent } from "./agent.js"

/** Distinctive content only present in fixture `src/index.ts`. */
export const INDEX_MAIN = "export function main"
/** Distinctive content only present in fixture `src/utils.ts`. */
export const UTILS_GREET = "export function greet"
/** Distinctive content only present in fixture `package.json`. */
export const PACKAGE_NAME = '"name": "sample-workspace"'

export function tabBarTrigger(page: Page, fileSuffix: string) {
  return page.locator(`[data-tab-id$="${fileSuffix}"]`)
}

export function activeTabSlot(page: Page) {
  return page.locator("[data-jet-tab-slot][data-jet-tab-active]")
}

export async function expectActiveTabSuffix(page: Page, fileSuffix: string): Promise<void> {
  const slot = activeTabSlot(page)
  await expect(slot).toHaveAttribute("data-jet-tab-slot", new RegExp(`${escapeRegex(fileSuffix)}$`))
  await expect(tabBarTrigger(page, fileSuffix)).toHaveAttribute("data-state", "active")
}

export async function clickTab(page: Page, fileSuffix: string): Promise<void> {
  await tabBarTrigger(page, fileSuffix).click()
}

/**
 * Assert editor body matches the expected buffer and (optionally) rejects stale content.
 * Uses getEditorText() so the assertion is tied to the CodeMirror doc, not tab chrome alone.
 */
export async function expectEditorBuffer(
  page: Page,
  opts: { contains: string; notContains?: string },
): Promise<void> {
  await expect(page.locator(".cm-editor")).toContainText(opts.contains)
  if (opts.notContains) {
    await expect(page.locator(".cm-editor")).not.toContainText(opts.notContains)
  }
  const text = await agent(page).getEditorText()
  expect(text).toContain(opts.contains)
  if (opts.notContains) expect(text).not.toContain(opts.notContains)
}

export async function expectSingleEditorMounted(page: Page): Promise<void> {
  await expect(page.locator(".cm-editor")).toHaveCount(1)
}

export async function switchTabExpectBuffer(
  page: Page,
  fileSuffix: string,
  opts: { contains: string; notContains?: string },
): Promise<void> {
  await clickTab(page, fileSuffix)
  await expectActiveTabSuffix(page, fileSuffix)
  await expectEditorBuffer(page, opts)
}

/** Assert tab chrome and CodeMirror doc agree — catches title/content drift. */
export async function expectEditorAndTabInSync(
  page: Page,
  fileSuffix: string,
  opts: { contains: string; notContains?: string },
): Promise<void> {
  await expectActiveTabSuffix(page, fileSuffix)
  await expectEditorBuffer(page, opts)
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Open buffer list overlay and select a row by filename (e.g. `index.ts`). */
export async function selectBufferFromList(page: Page, fileName: string): Promise<void> {
  await agent(page).executeCommand("workspace.bufferList")
  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  const listbox = dialog.getByRole("listbox")
  await expect(listbox.getByRole("option", { name: new RegExp(escapeRegex(fileName), "i") })).toBeVisible({
    timeout: 10_000,
  })
  await listbox.getByRole("option", { name: new RegExp(escapeRegex(fileName), "i") }).click()
  await expect(dialog).toBeHidden({ timeout: 5000 })
}

export async function expectMinOpenBuffers(page: Page, min: number): Promise<void> {
  await expect
    .poll(async () => (await agent(page).getState()).openBuffers.length, { timeout: 10_000 })
    .toBeGreaterThanOrEqual(min)
}
