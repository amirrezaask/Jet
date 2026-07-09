import { expect, test, type Locator, type Page } from "@playwright/test"
import { execCommand, hasPtySpawn, launchJet, showTerminal } from "./_launch.js"

const ptyAvailable = hasPtySpawn()

async function dragTabToPanelCenter(page: Page, tab: Locator, panel: Locator): Promise<void> {
  const tabBox = await tab.boundingBox()
  const overlayBox = await panel.locator("[data-jet-panel-drop-overlay]").boundingBox()
  if (!tabBox || !overlayBox) throw new Error("Tab or panel drop target is not measurable")

  await page.mouse.move(tabBox.x + tabBox.width / 2, tabBox.y + tabBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(
    overlayBox.x + overlayBox.width / 2,
    overlayBox.y + overlayBox.height / 2,
    { steps: 20 },
  )
  await expect(panel.locator('[data-drop-site="center"]')).toBeVisible()
  await page.mouse.up()
  await expect(page.locator("[data-jet-tab-drag-ghost]")).toBeHidden()
}

test.describe("electron terminal panel drag and focus", () => {
  test.skip(!ptyAvailable, "node-pty cannot spawn a shell on this machine")

  test("moves terminal tabs between panels and focuses split terminals by click", async () => {
    const { app, page } = await launchJet()
    const runtimeErrors: string[] = []
    page.on("pageerror", error => runtimeErrors.push(error.message))
    page.on("console", message => {
      if (message.type() === "error") runtimeErrors.push(message.text())
    })

    try {
      await showTerminal(page)
      await execCommand(page, "view.splitEditor")

      const livePanels = page.locator("[data-jet-panel-dock] [data-jet-panel-leaf]")
      const terminalPanel = livePanels.filter({
        has: page.locator("[data-jet-terminal-panel]"),
      })
      const emptyPanel = livePanels.filter({
        hasNot: page.locator("[data-jet-terminal-panel]"),
      })
      const targetPanelId = Number(await emptyPanel.getAttribute("data-jet-panel-leaf"))

      await dragTabToPanelCenter(page, terminalPanel.locator("[data-tab-id]"), emptyPanel)

      await expect(livePanels).toHaveCount(1)
      await expect(
        page.locator(
          `[data-jet-panel-dock] [data-jet-panel-leaf="${targetPanelId}"] [data-jet-terminal-panel]`,
        ),
      ).toBeVisible()
      await expect.poll(() => page.evaluate(() => window.__jetAgent!.getState().focusedPanel)).toBe(
        targetPanelId,
      )

      await execCommand(page, "terminal.new")
      const stackedPanel = page.locator(
        `[data-jet-panel-dock] [data-jet-panel-leaf="${targetPanelId}"]`,
      )
      await expect(stackedPanel.locator("[data-tab-id]")).toHaveCount(2)
      await execCommand(page, "view.splitEditor")
      const secondEmptyPanel = livePanels.filter({
        hasNot: page.locator("[data-jet-terminal-panel]"),
      })
      await dragTabToPanelCenter(
        page,
        stackedPanel.locator("[data-tab-id]").last(),
        secondEmptyPanel,
      )

      await expect(livePanels.locator("[data-jet-terminal-panel]")).toHaveCount(2)
      const terminalPanels = livePanels.filter({
        has: page.locator("[data-jet-terminal-panel]"),
      })
      const leftPanel = terminalPanels.first()
      const rightPanel = terminalPanels.last()
      const leftPanelId = Number(await leftPanel.getAttribute("data-jet-panel-leaf"))
      const rightPanelId = Number(await rightPanel.getAttribute("data-jet-panel-leaf"))

      await leftPanel.locator("[data-tab-id]").click()
      await expect.poll(() => page.evaluate(() => window.__jetAgent!.getState().focusedPanel)).toBe(
        leftPanelId,
      )

      await rightPanel.locator(".jet-terminal-surface").click()
      await expect.poll(() => page.evaluate(() => window.__jetAgent!.getState().focusedPanel)).toBe(
        rightPanelId,
      )

      const rightMarker = "JET-RIGHT-FOCUS-TEST"
      await page.keyboard.type(rightMarker)
      await expect
        .poll(async () => (await rightPanel.locator(".xterm-rows").textContent()) ?? "")
        .toContain(rightMarker)
      await expect
        .poll(async () => (await leftPanel.locator(".xterm-rows").textContent()) ?? "")
        .not.toContain(rightMarker)

      await leftPanel.locator(".jet-terminal-surface").click()
      await expect.poll(() => page.evaluate(() => window.__jetAgent!.getState().focusedPanel)).toBe(
        leftPanelId,
      )

      const leftMarker = "JET-LEFT-FOCUS-TEST"
      await page.keyboard.type(leftMarker)
      await expect
        .poll(async () => (await leftPanel.locator(".xterm-rows").textContent()) ?? "")
        .toContain(leftMarker)
      await expect
        .poll(async () => (await rightPanel.locator(".xterm-rows").textContent()) ?? "")
        .not.toContain(leftMarker)

      expect(runtimeErrors).toEqual([])
    } finally {
      await app.close()
    }
  })
})
