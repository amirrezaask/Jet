import { test, expect } from "@playwright/test"
import { boot, SAMPLE, waitAnimationsIdle } from "../helpers/boot.js"
import { agent } from "../helpers/agent.js"

const TERMINAL_PANEL = "[data-jet-terminal-panel]"

test("terminal: toggle opens stub panel in browser mode", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await waitAnimationsIdle(page)

  await agent(page).executeCommand("terminal.show")

  await expect(page.locator(TERMINAL_PANEL)).toBeVisible()
  await expect(page.locator(TERMINAL_PANEL)).toContainText("requires Electron")

  const stateAfterOpen = await agent(page).getState()
  expect(stateAfterOpen.workspace).toBeTruthy()
})

test("terminal: toggle again moves focus away from terminal tab", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await waitAnimationsIdle(page)

  await agent(page).executeCommand("terminal.show")
  await expect(page.locator(TERMINAL_PANEL)).toBeVisible()

  await agent(page).executeCommand("terminal.show")
  await waitAnimationsIdle(page)

  const state = await agent(page).getState()
  expect(state.focusedPanel).not.toBeNull()
  const activeSlot = page.locator(
    `[data-jet-panel-leaf="${state.focusedPanel}"] [data-jet-tab-slot][data-jet-tab-active]`,
  )
  const activeTabId = await activeSlot.getAttribute("data-jet-tab-slot")
  expect(activeTabId?.startsWith("jet:terminal:")).toBe(false)
  expect(activeTabId?.startsWith("file:") || activeTabId?.startsWith("untitled:")).toBe(true)
})

test("terminal: shell shortcuts work while terminal tab is focused", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await waitAnimationsIdle(page)

  await agent(page).executeCommand("terminal.show")
  await expect(page.locator(TERMINAL_PANEL)).toBeVisible()

  await page.keyboard.press("Meta+Shift+p")
  await expect(page.locator("body")).toContainText("Command palette")

  const state = await agent(page).getState()
  expect(state.paletteOpen).toBe(true)
})

test("terminal.new: creates additional terminal tab", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await waitAnimationsIdle(page)

  await agent(page).executeCommand("terminal.new")
  await expect(page.locator(TERMINAL_PANEL)).toBeVisible()

  await agent(page).executeCommand("terminal.new")
  await waitAnimationsIdle(page)

  await expect(page.locator("[data-jet-tab-bar]")).toContainText("Terminal 2")
  await expect(page.locator("[data-jet-tab-bar] [data-state='active']")).toContainText("Terminal 2")
})
