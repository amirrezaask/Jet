import { expect, test } from "@playwright/test"
import { expectSelectorVisible } from "../shell/assert.js"
import { expectListRows } from "../helpers/list.js"
import { EXPLORER_PANEL } from "../helpers/shell.js"
import { execCommand, launchJet } from "./_launch.js"

const EXPLORER_ITEMS = `${EXPLORER_PANEL} [data-jet-list-item]`

test.describe("RAD hot glow", () => {
  test("sets mouse-local CSS vars and soft-circle opacity on hovered row", async () => {
    const { app, page } = await launchJet()
    try {
      await execCommand(page, "explorer.show")
      await expectSelectorVisible(page, EXPLORER_PANEL)
      await expectListRows(page, { panel: "jet:explorer", minItems: 1, needle: "sample-workspace" })

      const row = page.locator(EXPLORER_ITEMS).first()
      const box = await row.boundingBox()
      expect(box, "explorer row must have a box").not.toBeNull()
      await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
      await page.waitForTimeout(50)

      const glow = await row.evaluate((el) => {
        const style = getComputedStyle(el)
        const before = getComputedStyle(el, "::before")
        return {
          hotX: style.getPropertyValue("--jet-hot-x").trim(),
          hotY: style.getPropertyValue("--jet-hot-y").trim(),
          beforeOpacity: before.opacity,
          beforeContent: before.content,
          beforeBg: before.backgroundImage,
          matchesHover: el.matches(":hover"),
          className: el.className,
          dataSlot: el.getAttribute("data-slot"),
        }
      })

      expect(
        glow.className.includes("jet-hot-glow") ||
          glow.className.includes("jet-interactive-row") ||
          glow.dataSlot === "sidebar-menu-sub-button",
        `row must be a hot-glow target (got class=${glow.className} slot=${glow.dataSlot})`,
      ).toBe(true)
      expect(glow.beforeContent, "::before soft circle must exist").not.toBe("none")
      expect(glow.beforeBg, `::before must use radial soft circle (got ${glow.beforeBg})`).toContain("radial-gradient")
      expect(glow.hotX, "--jet-hot-x must be set by tracker").toMatch(/px$/)
      expect(glow.hotY, "--jet-hot-y must be set by tracker").toMatch(/px$/)
      expect(glow.matchesHover, "row must match :hover after mouse move").toBe(true)
      expect(
        Number.parseFloat(glow.beforeOpacity),
        `::before opacity (hover=${glow.matchesHover} bg=${glow.beforeBg})`,
      ).toBeGreaterThan(0)

      // Virtualized rows must stay absolutely stacked (hot-glow must not force position:relative).
      const layout = await page.evaluate((sel) => {
        const els = [...document.querySelectorAll<HTMLElement>(sel)].slice(0, 3)
        return els.map((el) => {
          const r = el.getBoundingClientRect()
          return { top: r.top, height: r.height, position: getComputedStyle(el).position }
        })
      }, EXPLORER_ITEMS)
      expect(layout.length).toBeGreaterThanOrEqual(2)
      for (const row of layout) {
        expect(row.position, "tree row must stay position:absolute").toBe("absolute")
      }
      const gap = layout[1]!.top - layout[0]!.top
      expect(gap, "explorer row pitch").toBeGreaterThan(12)
      expect(gap, "explorer row pitch must stay dense").toBeLessThan(36)
    } finally {
      await app.close()
    }
  })
})
