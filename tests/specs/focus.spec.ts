import { test, expect } from "@playwright/test"
import { boot, SAMPLE } from "../helpers/boot.js"
import { agent } from "../helpers/agent.js"
import { showExplorer, EXPLORER_PANEL } from "../helpers/explorer.js"

test("focus: sidebar and editor focus commands", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await page.waitForTimeout(500)

  await showExplorer(page)

  await agent(page).executeCommand("workbench.action.focusSideBar")
  await page.waitForTimeout(200)
  await expect(page.locator(EXPLORER_PANEL)).toBeVisible()

  await agent(page).executeCommand("workbench.action.focusFirstEditorGroup")
  await page.waitForTimeout(200)

  const state = await agent(page).getState()
  expect(state.paletteOpen).toBe(false)
})
