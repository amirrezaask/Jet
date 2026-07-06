import { test, expect, type Page } from "@playwright/test"
import { boot, SAMPLE } from "../helpers/boot.js"
import { agent } from "../helpers/agent.js"
import { focusEditor } from "../helpers/editor.js"

async function inputCaretState(page: Page, selector: string) {
  return page.locator(selector).evaluate(el => {
    const anchor = el.parentElement
    const bar = anchor?.querySelector<HTMLElement>('[data-jet-input-caret="bar"]')
    const streak = anchor?.querySelector<SVGSVGElement>('[data-jet-input-caret="streak-layer"]')
    return {
      barDisplay: bar ? getComputedStyle(bar).display : null,
      streakDisplay: streak ? getComputedStyle(streak).display : null,
    }
  })
}

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

test("animation: command palette input shows custom caret and no idle streak", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await agent(page).executeCommand("ui.showCommandPalette")
  const input = page.locator('[data-slot="command-input"]')
  await expect(input).toBeVisible()
  await expect.poll(() => inputCaretState(page, '[data-slot="command-input"]')).toMatchObject({
    barDisplay: "block",
    streakDisplay: "none",
  })
})

test("animation: goto line caret hides on blur and selection", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await agent(page).executeCommand("editor.gotoLine")
  const input = page.locator("#goto-line-input")
  await expect(input).toBeVisible()

  await expect.poll(() => inputCaretState(page, "#goto-line-input")).toMatchObject({
    barDisplay: "block",
    streakDisplay: "none",
  })

  await page.evaluate(() => {
    const active = document.activeElement
    if (active instanceof HTMLElement) active.blur()
  })
  await expect.poll(() => inputCaretState(page, "#goto-line-input")).toMatchObject({
    barDisplay: "none",
    streakDisplay: "none",
  })

  await input.evaluate((el: HTMLInputElement) => {
    el.focus()
    el.value = "12345"
    el.setSelectionRange(1, 4)
    el.dispatchEvent(new Event("input", { bubbles: true }))
    el.dispatchEvent(new Event("select", { bubbles: true }))
  })
  await expect.poll(() => inputCaretState(page, "#goto-line-input")).toMatchObject({
    barDisplay: "none",
    streakDisplay: "none",
  })
})

test("animation: goto line shows a streak during caret hops", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await agent(page).executeCommand("editor.gotoLine")
  const input = page.locator("#goto-line-input")
  await expect(input).toBeVisible()
  await input.evaluate((el: HTMLInputElement) => {
    el.focus()
    el.value = "12345678901234567890"
    el.setSelectionRange(el.value.length, el.value.length)
    el.dispatchEvent(new Event("input", { bubbles: true }))
    el.dispatchEvent(new Event("select", { bubbles: true }))
  })
  await input.evaluate((el: HTMLInputElement) => {
    el.setSelectionRange(0, 0)
    el.dispatchEvent(new Event("select", { bubbles: true }))
  })

  await expect
    .poll(() => inputCaretState(page, "#goto-line-input").then(state => state.streakDisplay), {
      timeout: 1_000,
      intervals: [10, 20, 50],
    })
    .toBe("block")

  await expect
    .poll(() => inputCaretState(page, "#goto-line-input").then(state => state.streakDisplay), {
      timeout: 1_000,
      intervals: [50, 100, 150],
    })
    .toBe("none")
})

test("animation: split editor keeps panel leaf structure", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await agent(page).waitForEditor()
  await agent(page).executeCommand("view.splitEditor")
  await expect(page.locator("[data-jet-panel-leaf]")).toHaveCount(2)
})
