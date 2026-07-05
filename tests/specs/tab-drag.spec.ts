import { test, expect } from "@playwright/test"
import { boot, SAMPLE } from "../helpers/boot.js"
import { agent } from "../helpers/agent.js"
import { dispatchTabBarDrag, dispatchTabDrag, tabIdsInPanel } from "../helpers/drag.js"

type PanelSummary = { id: number; kind: string }

async function editorPanelCount(page: import("@playwright/test").Page): Promise<number> {
  const state = await agent(page).getState()
  return state.panels.filter((p: PanelSummary) => p.kind === "editor").length
}

async function bootWithTwoTabs(page: import("@playwright/test").Page): Promise<void> {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await agent(page).openFile("src/utils.ts")
  await agent(page).waitForEditor()
}

test("tab-drag: split editor by dropping tab on left edge of same panel", async ({ page }) => {
  await bootWithTwoTabs(page)
  await dispatchTabDrag(page, { sourceTabIndex: 1, targetPanelIndex: 0, zone: "left" })

  await page.waitForFunction(
    () => (window.__jetAgent!.getState() as { panels: PanelSummary[] }).panels.filter(p => p.kind === "editor").length >= 2,
    { timeout: 8000 },
  )
  expect(await editorPanelCount(page)).toBe(2)
})

test("tab-drag: split editor by dropping tab on top edge", async ({ page }) => {
  await bootWithTwoTabs(page)
  await dispatchTabDrag(page, { sourceTabIndex: 1, targetPanelIndex: 0, zone: "top" })

  await page.waitForFunction(
    () => (window.__jetAgent!.getState() as { panels: PanelSummary[] }).panels.filter(p => p.kind === "editor").length >= 2,
    { timeout: 8000 },
  )
  expect(await editorPanelCount(page)).toBe(2)
})

test("tab-drag: split editor by dropping tab on right edge of same panel", async ({ page }) => {
  await bootWithTwoTabs(page)
  expect(await editorPanelCount(page)).toBe(1)
  await expect(page.locator("[data-tab-id]")).toHaveCount(2)

  await dispatchTabDrag(page, { sourceTabIndex: 1, targetPanelIndex: 0, zone: "right" })

  await page.waitForFunction(
    () => (window.__jetAgent!.getState() as { panels: PanelSummary[] }).panels.filter(p => p.kind === "editor").length >= 2,
    { timeout: 8000 },
  )
  expect(await editorPanelCount(page)).toBe(2)
})

test("tab-drag: split editor vertically by dropping tab on bottom edge", async ({ page }) => {
  await bootWithTwoTabs(page)
  await dispatchTabDrag(page, { sourceTabIndex: 1, targetPanelIndex: 0, zone: "bottom" })

  await page.waitForFunction(
    () => (window.__jetAgent!.getState() as { panels: PanelSummary[] }).panels.filter(p => p.kind === "editor").length >= 2,
    { timeout: 8000 },
  )
  expect(await editorPanelCount(page)).toBe(2)
})

test("tab-drag: drag tab center of another panel merges it there", async ({ page }) => {
  await bootWithTwoTabs(page)
  await dispatchTabDrag(page, { sourceTabIndex: 1, targetPanelIndex: 0, zone: "right" })
  await page.waitForFunction(
    () => (window.__jetAgent!.getState() as { panels: PanelSummary[] }).panels.filter(p => p.kind === "editor").length >= 2,
    { timeout: 8000 },
  )
  expect(await editorPanelCount(page)).toBe(2)

  await agent(page).openFile("src/example.rs")
  await page.waitForTimeout(300)

  const beforeTabsPerPanel = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-jet-panel-leaf]")).map(
      leaf => leaf.querySelectorAll("[data-tab-id]").length,
    ),
  )
  expect(beforeTabsPerPanel[0]).toBeGreaterThanOrEqual(1)
  expect(beforeTabsPerPanel[1]).toBeGreaterThanOrEqual(1)

  const panel0Count = beforeTabsPerPanel[0]!
  const panel1Count = beforeTabsPerPanel[1]!
  const sourceTabIndex = panel0Count + panel1Count - 1
  await dispatchTabDrag(page, { sourceTabIndex, targetPanelIndex: 0, zone: "center" })

  await page.waitForFunction(
    prev => {
      const leaves = document.querySelectorAll("[data-jet-panel-leaf]")
      if (leaves.length < 2) return false
      return leaves[0]!.querySelectorAll("[data-tab-id]").length > prev
    },
    panel0Count,
    { timeout: 8000 },
  )

  const afterTabsPerPanel = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-jet-panel-leaf]")).map(
      leaf => leaf.querySelectorAll("[data-tab-id]").length,
    ),
  )
  expect(afterTabsPerPanel[0]).toBeGreaterThan(beforeTabsPerPanel[0]!)
  expect(afterTabsPerPanel[1]).toBeLessThan(beforeTabsPerPanel[1]!)
})

test("tab-drag: same-panel tab reorder via tab bar", async ({ page }) => {
  await bootWithTwoTabs(page)
  const before = await tabIdsInPanel(page, 0)
  expect(before.length).toBe(2)

  await dispatchTabBarDrag(page, {
    sourceTabIndex: 1,
    targetPanelIndex: 0,
    targetTabIndex: 0,
    side: "left",
  })

  await page.waitForTimeout(200)
  const after = await tabIdsInPanel(page, 0)
  expect(after.length).toBe(2)
  expect(after[0]).toBe(before[1])
  expect(after[1]).toBe(before[0])
})

test("tab-drag: cross-panel tab bar insert at index", async ({ page }) => {
  await bootWithTwoTabs(page)
  await dispatchTabDrag(page, { sourceTabIndex: 1, targetPanelIndex: 0, zone: "right" })
  await page.waitForFunction(
    () => (window.__jetAgent!.getState() as { panels: PanelSummary[] }).panels.filter(p => p.kind === "editor").length >= 2,
    { timeout: 8000 },
  )

  await agent(page).openFile("src/example.rs")
  await page.waitForTimeout(300)

  const panel0Before = await tabIdsInPanel(page, 0)
  const panel1Before = await tabIdsInPanel(page, 1)
  expect(panel1Before.length).toBeGreaterThanOrEqual(1)

  const sourceTabIndex = panel0Before.length
  await dispatchTabBarDrag(page, {
    sourceTabIndex,
    targetPanelIndex: 0,
    targetTabIndex: 0,
    side: "left",
  })

  await page.waitForTimeout(300)
  const panel0After = await tabIdsInPanel(page, 0)
  expect(panel0After.length).toBe(panel0Before.length + 1)
  expect(panel0After[0]).toBe(panel1Before[0])
})

test("tab-drag: dragging only tab in panel collapses source panel after split", async ({ page }) => {
  await bootWithTwoTabs(page)
  await dispatchTabDrag(page, { sourceTabIndex: 1, targetPanelIndex: 0, zone: "right" })
  await page.waitForFunction(
    () => (window.__jetAgent!.getState() as { panels: PanelSummary[] }).panels.filter(p => p.kind === "editor").length >= 2,
    { timeout: 8000 },
  )
  expect(await editorPanelCount(page)).toBe(2)

  const secondPanelTabsBefore = await page.evaluate(() => {
    const leaf = document.querySelectorAll<HTMLElement>("[data-jet-panel-leaf]")[1]
    return leaf!.querySelectorAll("[data-tab-id]").length
  })
  expect(secondPanelTabsBefore).toBe(1)

  const firstPanelTabCount = await page.evaluate(() => {
    const leaf = document.querySelectorAll<HTMLElement>("[data-jet-panel-leaf]")[0]
    return leaf!.querySelectorAll("[data-tab-id]").length
  })
  await dispatchTabDrag(page, { sourceTabIndex: firstPanelTabCount, targetPanelIndex: 0, zone: "center" })

  await page.waitForFunction(
    () => (window.__jetAgent!.getState() as { panels: PanelSummary[] }).panels.filter(p => p.kind === "editor").length === 1,
    { timeout: 8000 },
  )
  expect(await editorPanelCount(page)).toBe(1)
})
