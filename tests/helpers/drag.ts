import type { Page } from "@playwright/test"

export type DragZone = "center" | "left" | "right" | "top" | "bottom"

export type TabDragOpts = {
  sourceTabIndex: number
  targetPanelIndex?: number
  zone: DragZone
}

export type TabBarDragOpts = {
  sourceTabIndex: number
  targetPanelIndex: number
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

/** Pointer drag for @dnd-kit tab DnD (activation distance ~6px). */
async function pointerDragTab(
  page: Page,
  sourceTabIndex: number,
  endX: number,
  endY: number,
): Promise<void> {
  const tab = page.locator("[data-tab-id]").nth(sourceTabIndex)
  await tab.waitFor({ state: "visible" })
  const box = await tab.boundingBox()
  if (!box) throw new Error(`no tab at index ${sourceTabIndex}`)

  const startX = box.x + box.width / 2
  const startY = box.y + box.height / 2

  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + 10, startY, { steps: 2 })
  await page.waitForTimeout(50)
  await page.mouse.move(endX, endY, { steps: 16 })
  await page.waitForTimeout(80)
  await page.mouse.up()
  await waitFrames(page, 4)
}

export async function dispatchTabBarDrag(page: Page, opts: TabBarDragOpts): Promise<void> {
  const targetTab = page
    .locator("[data-jet-panel-leaf]")
    .nth(opts.targetPanelIndex)
    .locator("[data-tab-id]")
    .nth(opts.targetTabIndex)
  await targetTab.waitFor({ state: "visible" })
  const tr = await targetTab.boundingBox()
  if (!tr) throw new Error("target tab not found")

  const endX = opts.side === "left" ? tr.x + Math.min(4, tr.width * 0.15) : tr.x + tr.width - Math.min(4, tr.width * 0.15)
  const endY = tr.y + tr.height / 2

  await pointerDragTab(page, opts.sourceTabIndex, endX, endY)
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

  await page.waitForFunction(
    ({ sourceTabIndex }) => document.querySelectorAll("[data-tab-id]").length > sourceTabIndex,
    { sourceTabIndex: opts.sourceTabIndex },
  )

  const tab = page.locator("[data-tab-id]").nth(opts.sourceTabIndex)
  const tabBox = await tab.boundingBox()
  if (!tabBox) throw new Error(`no tab at index ${opts.sourceTabIndex}`)

  const startX = tabBox.x + tabBox.width / 2
  const startY = tabBox.y + tabBox.height / 2

  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + 10, startY, { steps: 2 })

  await page.waitForFunction(
    ({ targetPanelIndex }) => {
      const overlay = document.querySelectorAll<HTMLElement>("[data-jet-panel-drop-overlay]")[targetPanelIndex]
      return Boolean(overlay?.dataset.jetDropSites)
    },
    { targetPanelIndex },
    { timeout: 5000 },
  )

  const end = await page.evaluate(
    ({ targetPanelIndex, zone }) => {
      const overlay = document.querySelectorAll<HTMLElement>("[data-jet-panel-drop-overlay]")[targetPanelIndex]
      if (!overlay?.dataset.jetDropSites) throw new Error("drop sites not ready")
      const sites = JSON.parse(overlay.dataset.jetDropSites) as {
        id: string
        rect: { x: number; y: number; w: number; h: number }
      }[]
      const site = sites.find(s => s.id === zone)
      if (!site) throw new Error(`drop site ${zone} not found`)
      const r = overlay.getBoundingClientRect()
      return {
        x: r.left + site.rect.x + site.rect.w / 2,
        y: r.top + site.rect.y + site.rect.h / 2,
      }
    },
    { targetPanelIndex, zone: opts.zone },
  )

  await page.mouse.move(end.x, end.y, { steps: 16 })
  await page.waitForTimeout(80)
  await page.mouse.up()
  await waitFrames(page, 4)
}
