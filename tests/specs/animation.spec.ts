import { test, expect } from "@playwright/test"
import { boot, SAMPLE } from "../helpers/boot.js"
import { agent } from "../helpers/agent.js"
import { focusEditor } from "../helpers/editor.js"

test("animation: command palette uses jet overlay motion classes", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await agent(page).executeCommand("ui.showCommandPalette")
  const content = page.locator('[data-slot="dialog-content"]')
  await expect(content).toBeVisible()
  const cls = await content.getAttribute("class")
  expect(cls).toContain("jet-overlay-enter")
  expect(cls).toContain("zoom-in-90")
})

test("animation: dialog scrim uses backdrop blur when open", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await agent(page).executeCommand("ui.showCommandPalette")
  const overlay = page.locator('[data-slot="dialog-overlay"]')
  await expect(overlay).toBeVisible()
  const cls = await overlay.getAttribute("class")
  expect(cls).toContain("backdrop-blur-[10px]")
})

test("animation: squish scale token is 0.9 on root", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  const squish = await page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--jet-motion-squish-scale")
      .trim(),
  )
  expect(squish).toBe("0.9")
})

test("animation: editor bar cursor mounts when focused", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await agent(page).waitForEditor()
  await focusEditor(page)
  await page.keyboard.type("abc")
  await expect(page.locator(".cm-editor.cm-focused .cm-cursor-primary")).toHaveCount(1)
  await expect(page.locator(".jet-cursor-layer")).toHaveCount(0)
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

test("animation: split editor keeps panel leaf structure", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await agent(page).waitForEditor()
  await agent(page).executeCommand("view.splitEditor")
  await expect(page.locator("[data-jet-panel-leaf]")).toHaveCount(2)
})
