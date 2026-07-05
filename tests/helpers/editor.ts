import type { Page } from "@playwright/test"
import { expect } from "@playwright/test"
import { agent } from "./agent.js"

export async function focusEditor(page: Page): Promise<void> {
  await page.locator(".cm-content").click()
}

export async function typeInEditor(page: Page, text: string): Promise<void> {
  await focusEditor(page)
  await page.keyboard.type(text)
}

export async function expectEditorContains(page: Page, needle: string): Promise<void> {
  await expect(page.locator(".cm-editor")).toContainText(needle)
}

export async function expectEditorText(page: Page, needle: string): Promise<void> {
  const text = await agent(page).getEditorText()
  expect(text).toContain(needle)
}

export async function expectCursorLine(page: Page, line: number): Promise<void> {
  await page.waitForFunction(
    expected =>
      window.__jetAgent!.getCursorPosition()?.line === expected,
    line,
    { timeout: 5000 },
  )
}

export async function runEditorCommand(page: Page, commandId: string): Promise<void> {
  await agent(page).executeCommand(commandId)
}
