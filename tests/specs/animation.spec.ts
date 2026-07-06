import { test, expect } from "@playwright/test"
import { boot, SAMPLE } from "../helpers/boot.js"
import { agent } from "../helpers/agent.js"

test("animation: command palette uses jet overlay motion classes", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await agent(page).executeCommand("ui.showCommandPalette")
  const content = page.locator('[data-slot="dialog-content"]')
  await expect(content).toBeVisible()
  const cls = await content.getAttribute("class")
  expect(cls).toContain("zoom-in-96")
})

test("animation: editor bracket cursor layer mounts", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await agent(page).waitForEditor()
  await page.locator(".cm-content").click()
  await page.keyboard.type("abc")
  await expect(page.locator(".jet-cursor-layer")).toHaveCount(1)
})

test("animation: tactile press tokens and button class wired", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  const scale = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--jet-press-scale").trim(),
  )
  expect(scale).toBe("0.97")

  await agent(page).executeCommand("ui.showCommandPalette")
  const btn = page.locator('[data-slot="button"]').first()
  await expect(btn).toBeVisible()
  const cls = await btn.getAttribute("class")
  expect(cls).toContain("jet-press")
})
