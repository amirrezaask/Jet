import { test, expect } from "@playwright/test"

test("jet web smoke: workspace, editor, agent API", async ({ page }) => {
  await page.goto("/?workspace=fixtures/sample-workspace&file=src/index.ts")

  await page.waitForFunction(() => window.__jetAgent != null)
  await page.evaluate(async () => {
    await window.__jetAgent!.waitForReady()
    await window.__jetAgent!.waitForEditor()
  })

  const state = await page.evaluate(() => window.__jetAgent!.getState())
  expect(state.workspace).toContain("sample-workspace")
  expect(state.tabs.some(t => t.kind === "editor")).toBe(true)

  await expect(page.locator(".cm-editor")).toBeVisible()
})
