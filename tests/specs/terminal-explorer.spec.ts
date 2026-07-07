import { test, expect } from "@playwright/test"
import { boot, SAMPLE, waitAnimationsIdle } from "../helpers/boot.js"
import { agent } from "../helpers/agent.js"
import { expectLayout, expectRowTextVisible } from "../helpers/list.js"

const TERMINAL_EXPLORER_PANEL = '[data-jet-list-panel="terminal-explorer"]'
const TERMINAL_EXPLORER_ITEMS = `${TERMINAL_EXPLORER_PANEL} [data-jet-list-item]`
const TERMINAL_PANEL = "[data-jet-terminal-panel]"

test("terminal explorer: lists open terminals grouped by workspace", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await waitAnimationsIdle(page)

  await agent(page).executeCommand("terminal.new")
  await expect(page.locator(TERMINAL_PANEL)).toBeVisible()

  await agent(page).executeCommand("terminal.new")
  await waitAnimationsIdle(page)

  await agent(page).executeCommand("terminal.explorer.show")
  await page.waitForSelector(TERMINAL_EXPLORER_PANEL, { timeout: 15_000 })

  await expectLayout(page, {
    selector: TERMINAL_EXPLORER_ITEMS,
    minItems: 2,
    minUniqueTops: 2,
    minRowHeight: 22,
  })
  await expect(page.locator(TERMINAL_EXPLORER_PANEL)).toContainText("Terminal")
  await expect(page.locator(TERMINAL_EXPLORER_PANEL)).toContainText("Terminal 2")
  await expect(page.locator(TERMINAL_EXPLORER_PANEL)).not.toContainText("No results")
  await expectRowTextVisible(page, TERMINAL_EXPLORER_ITEMS, "Terminal 2")
})

test("terminal explorer: clicking row focuses terminal tab", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await waitAnimationsIdle(page)

  await agent(page).executeCommand("terminal.new")
  await agent(page).executeCommand("terminal.new")
  await agent(page).executeCommand("terminal.explorer.show")
  await page.waitForSelector(TERMINAL_EXPLORER_PANEL, { timeout: 15_000 })

  await page.locator(TERMINAL_EXPLORER_ITEMS).filter({ hasText: "Terminal 2" }).click()
  await waitAnimationsIdle(page)

  const state = await agent(page).getState()
  expect(state.focusedPanel).not.toBeNull()
  const activeSlot = page.locator(
    `[data-jet-panel-leaf="${state.focusedPanel}"] [data-jet-tab-slot][data-jet-tab-active]`,
  )
  const activeTabId = await activeSlot.getAttribute("data-jet-tab-slot")
  expect(activeTabId?.startsWith("jet:terminal:")).toBe(true)
  await expect(activeSlot.locator(TERMINAL_PANEL)).toBeVisible()
})

test("terminal explorer: plus creates another terminal", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await waitAnimationsIdle(page)

  await agent(page).executeCommand("terminal.new")
  await agent(page).executeCommand("terminal.explorer.show")
  await page.waitForSelector(TERMINAL_EXPLORER_PANEL, { timeout: 15_000 })

  const plusButton = page.locator(`${TERMINAL_EXPLORER_PANEL} button[title="New terminal"]`).first()
  await plusButton.click()
  await waitAnimationsIdle(page)

  await expectLayout(page, {
    selector: TERMINAL_EXPLORER_ITEMS,
    minItems: 2,
    minUniqueTops: 2,
    minRowHeight: 22,
  })
  await expectRowTextVisible(page, TERMINAL_EXPLORER_ITEMS, "Terminal 2")
})

test("terminal explorer: context menu closes terminal", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await waitAnimationsIdle(page)

  await agent(page).executeCommand("terminal.new")
  await agent(page).executeCommand("terminal.new")
  await agent(page).executeCommand("terminal.explorer.show")
  await page.waitForSelector(TERMINAL_EXPLORER_PANEL, { timeout: 15_000 })

  const row = page.locator(TERMINAL_EXPLORER_ITEMS).filter({ hasText: "Terminal 2" })
  await row.click({ button: "right" })
  await page.getByRole("menuitem", { name: "Close Terminal" }).click()
  await waitAnimationsIdle(page)

  await expectLayout(page, {
    selector: TERMINAL_EXPLORER_ITEMS,
    minItems: 1,
    minRowHeight: 22,
  })
  await expect(page.locator(TERMINAL_EXPLORER_PANEL)).not.toContainText("Terminal 2")
})
