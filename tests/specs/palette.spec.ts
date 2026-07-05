import { test, expect } from "@playwright/test"
import { boot, SAMPLE, waitAnimationsIdle } from "../helpers/boot.js"
import { agent } from "../helpers/agent.js"
import { expectLayout, expectRowTextVisible } from "../helpers/list.js"

test.beforeEach(async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
})

test("palette: opens with commands listed", async ({ page }) => {
  await agent(page).executeCommand("ui.showCommandPalette")
  await waitAnimationsIdle(page)

  await expect(page.locator("body")).toContainText("Command palette")
  await expect(page.locator("body")).toContainText("Show Command Palette")
  await expect(page.locator("body")).toContainText("Quick Open File")
  await expect(page.locator("body")).not.toContainText("[selected]")

  await expectLayout(page, {
    selector: "[role=\"option\"], [data-jet-list-item]",
    minItems: 5,
    minUniqueTops: 5,
    minRowHeight: 20,
  })
  await expectRowTextVisible(page, {
    selector: "[role=\"option\"], [data-jet-list-item]",
    minItems: 5,
  })

  const state = await agent(page).getState()
  expect(state.paletteOpen).toBe(true)
})

test("palette: filter narrows commands", async ({ page }) => {
  await agent(page).executeCommand("ui.showCommandPalette")
  await page.waitForTimeout(300)
  await page.keyboard.type("explorer")
  await page.waitForTimeout(200)

  await expect(page.locator("body")).toContainText("Show Explorer")
  await expect(page.locator("body")).not.toContainText("No commands")
  await expect(page.locator("body")).not.toContainText("No results")
})

test("palette: closes on Escape", async ({ page }) => {
  await agent(page).executeCommand("ui.showCommandPalette")
  await page.waitForTimeout(300)
  await page.keyboard.press("Escape")
  await page.waitForTimeout(200)

  const state = await agent(page).getState()
  expect(state.paletteOpen).toBe(false)
})

test("palette: no pre-selection on open", async ({ page }) => {
  await agent(page).executeCommand("ui.showCommandPalette")
  await waitAnimationsIdle(page)

  await expect(page.locator("body")).not.toContainText("[selected]")
  await expectLayout(page, {
    selector: "[role=\"option\"], [data-jet-list-item]",
    minItems: 5,
    minRowHeight: 20,
  })
})

test("palette: running a command closes palette", async ({ page }) => {
  await agent(page).executeCommand("ui.showCommandPalette")
  await page.waitForTimeout(300)
  const state1 = await agent(page).getState()
  expect(state1.paletteOpen).toBe(true)

  await page.keyboard.type("quick open")
  await page.waitForTimeout(200)
  await expect(page.locator("body")).toContainText("Quick Open")
  await page.keyboard.press("Enter")
  await page.waitForTimeout(400)

  const state2 = await agent(page).getState()
  expect(state2.paletteOpen).toBe(false)
  await expect(page.locator("body")).toContainText("file name")
  await page.keyboard.press("Escape")
})
