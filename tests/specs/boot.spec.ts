import { test, expect } from "@playwright/test"
import { boot, SAMPLE } from "../helpers/boot.js"
import { agent } from "../helpers/agent.js"

test("boot: workspace, editor, agent API ready", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })

  const state = await agent(page).getState()
  expect(state.workspace).toContain("sample-workspace")
  expect(state.panels.some(p => p.kind === "editor")).toBe(true)
  await expect(page.locator(".cm-editor")).toBeVisible()
})
