import type { Page } from "@playwright/test"

export type DragZone = "center" | "left" | "right" | "top" | "bottom"

const ZONE_OFFSETS: Record<DragZone, [number, number]> = {
  center: [0.5, 0.5],
  left: [0.05, 0.5],
  right: [0.95, 0.5],
  top: [0.5, 0.05],
  bottom: [0.5, 0.95],
}

export type TabDragOpts = {
  sourceTabIndex: number
  targetPanelIndex?: number
  zone: DragZone
}

export type TabBarDragOpts = {
  sourceTabIndex: number
  targetPanelIndex: number
  /** Tab index within target panel's tab bar to drop beside. */
  targetTabIndex: number
  side: "left" | "right"
}

async function waitFrames(page: Page, count = 2): Promise<void> {
  await page.evaluate(
    n =>
      new Promise<void>(resolve => {
        let left = n
        const step = () => {
          left -= 1
          if (left <= 0) resolve()
          else requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
      }),
    count,
  )
}

// Playwright's mouse.down/move/up doesn't reliably fire HTML5 dragstart on
// draggable=true React elements. Dispatch native DragEvents directly.
export async function dispatchTabBarDrag(page: Page, opts: TabBarDragOpts): Promise<void> {
  await page.evaluate(
    async ({ sourceTabIndex, targetPanelIndex, targetTabIndex, side }) => {
      const tabEls = document.querySelectorAll<HTMLElement>("[data-tab-id]")
      const sourceTab = tabEls[sourceTabIndex]
      if (!sourceTab) throw new Error(`no tab at index ${sourceTabIndex}`)
      const leaves = document.querySelectorAll<HTMLElement>("[data-jet-panel-leaf]")
      const targetLeaf = leaves[targetPanelIndex]
      if (!targetLeaf) throw new Error(`no leaf at index ${targetPanelIndex}`)
      const targetTabs = targetLeaf.querySelectorAll<HTMLElement>("[data-tab-id]")
      const targetTab = targetTabs[targetTabIndex]
      if (!targetTab) throw new Error(`no target tab at index ${targetTabIndex}`)
      const tabBar = targetLeaf.querySelector<HTMLElement>("[data-jet-tab-bar]")
      if (!tabBar) throw new Error("tab bar not found")

      const dt = new DataTransfer()
      const payload = (() => {
        const bar = sourceTab.closest<HTMLElement>("[data-jet-tab-bar]")
        const panelId = bar?.dataset.panelId
        const tabId = sourceTab.dataset.tabId
        if (!panelId || !tabId) throw new Error("tab drag payload missing panel/tab id")
        return `${panelId}|${tabId}`
      })()
      dt.setData("application/x-jet-tab", payload)
      const tabRect = sourceTab.getBoundingClientRect()
      const sx = tabRect.x + tabRect.width / 2
      const sy = tabRect.y + tabRect.height / 2
      sourceTab.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: sx, clientY: sy }))
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))

      const tr = targetTab.getBoundingClientRect()
      const ex = side === "left" ? tr.left + Math.min(4, tr.width * 0.15) : tr.right - Math.min(4, tr.width * 0.15)
      const ey = tr.top + tr.height / 2

      tabBar.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: ex, clientY: ey }))
      tabBar.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: ex, clientY: ey }))
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
      tabBar.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: ex, clientY: ey }))
      sourceTab.dispatchEvent(new DragEvent("dragend", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: ex, clientY: ey }))
    },
    opts,
  )
  await waitFrames(page, 4)
}

export async function tabIdsInPanel(page: Page, panelIndex: number): Promise<string[]> {
  return page.evaluate(idx => {
    const leaf = document.querySelectorAll<HTMLElement>("[data-jet-panel-leaf]")[idx]
    if (!leaf) return []
    return Array.from(leaf.querySelectorAll("[data-tab-id]")).map(el => el.getAttribute("data-tab-id") ?? "")
  }, panelIndex)
}

export async function dispatchTabDrag(page: Page, opts: TabDragOpts): Promise<void> {
  const targetPanelIndex = opts.targetPanelIndex ?? 0
  const [fx, fy] = ZONE_OFFSETS[opts.zone]

  await page.waitForFunction(
    ({ sourceTabIndex }) => document.querySelectorAll("[data-tab-id]").length > sourceTabIndex,
    { sourceTabIndex: opts.sourceTabIndex },
  )

  await page.evaluate(
    async ({ sourceTabIndex, targetPanelIndex, fx, fy }) => {
      const tabEls = document.querySelectorAll<HTMLElement>("[data-tab-id]")
      const sourceTab = tabEls[sourceTabIndex]
      if (!sourceTab) throw new Error(`no tab at index ${sourceTabIndex}`)
      const leaves = document.querySelectorAll<HTMLElement>("[data-jet-panel-leaf]")
      const targetLeaf = leaves[targetPanelIndex]
      if (!targetLeaf) throw new Error(`no leaf at index ${targetPanelIndex}`)

      const dt = new DataTransfer()
      const payload = (() => {
        const bar = sourceTab.closest<HTMLElement>("[data-jet-tab-bar]")
        const panelId = bar?.dataset.panelId
        const tabId = sourceTab.dataset.tabId
        if (!panelId || !tabId) throw new Error("tab drag payload missing panel/tab id")
        return `${panelId}|${tabId}`
      })()
      dt.setData("application/x-jet-tab", payload)
      const tabRect = sourceTab.getBoundingClientRect()
      const sx = tabRect.x + tabRect.width / 2
      const sy = tabRect.y + tabRect.height / 2
      sourceTab.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: sx, clientY: sy }))

      for (let i = 0; i < 6; i++) {
        await new Promise(r => requestAnimationFrame(r))
      }

      const overlay = targetLeaf.querySelector<HTMLElement>("[data-jet-panel-drop-overlay]")
      if (!overlay) throw new Error("overlay not mounted — drag context may not have started")
      const rect = overlay.getBoundingClientRect()
      const ex = rect.x + rect.width * fx
      const ey = rect.y + rect.height * fy

      overlay.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: ex, clientY: ey }))
      overlay.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: ex, clientY: ey }))
      await new Promise(r => setTimeout(r, 32))
      overlay.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: ex, clientY: ey }))
      await new Promise(r => setTimeout(r, 32))
      overlay.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: ex, clientY: ey }))
      sourceTab.dispatchEvent(new DragEvent("dragend", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: ex, clientY: ey }))
    },
    { sourceTabIndex: opts.sourceTabIndex, targetPanelIndex, fx, fy },
  )

  await waitFrames(page, 4)
}
