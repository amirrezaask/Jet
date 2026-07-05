import { test, expect } from "@playwright/test"
import { boot, SAMPLE, waitAnimationsIdle } from "../helpers/boot.js"
import { agent } from "../helpers/agent.js"
import { expectLayout, expectRowTextVisible } from "../helpers/list.js"

test.beforeEach(async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await page.waitForTimeout(3000) // wait for file indexing
})

test("quick-open: filter shows matching files", async ({ page }) => {
  await agent(page).executeCommand("workspace.quickOpen")
  await waitAnimationsIdle(page)

  await page.keyboard.type("util")
  await page.waitForTimeout(500)

  await expect(page.locator("body")).toContainText("utils.ts")
  await expect(page.locator("body")).not.toContainText("No results")
  await expectLayout(page, {
    selector: "[data-jet-list-item], [role=\"option\"]",
    minItems: 1,
    minRowHeight: 20,
  })
  await page.keyboard.press("Escape")
})

test("quick-open: no results for garbage query", async ({ page }) => {
  await agent(page).executeCommand("workspace.quickOpen")
  await waitAnimationsIdle(page)

  await page.keyboard.type("zzzznotafile")
  await page.waitForFunction(() => {
    const dialog = document.querySelector('[role="dialog"]')
    if (!dialog) return false
    const items = [...dialog.querySelectorAll<HTMLElement>("[cmdk-item]")].filter(
      el => !el.classList.contains("hidden") && el.getAttribute("aria-hidden") !== "true",
    )
    return items.length === 0
  }, { timeout: 10_000 })

  await expect(page.getByRole("combobox")).toHaveValue("zzzznotafile")
  await page.keyboard.press("Escape")
})

test("quick-open: row text is visible", async ({ page }) => {
  await agent(page).executeCommand("workspace.quickOpen")
  await waitAnimationsIdle(page)

  await page.keyboard.type("ts")
  await page.waitForTimeout(400)

  await expectLayout(page, {
    selector: "[data-jet-list-item], [role=\"option\"]",
    minItems: 1,
  })
  await expectRowTextVisible(page, {
    selector: "[data-jet-list-item], [role=\"option\"]",
    minItems: 1,
    minGlyphHeightPx: 10,
  })
  await page.keyboard.press("Escape")
})
