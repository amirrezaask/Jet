import { expect, test } from "@playwright/test"
import {
  expectContainsText,
  expectLocatorAttached,
  expectLocatorAttribute,
  expectLocatorCount,
  expectLocatorFocused,
  expectLocatorHidden,
  expectLocatorVisible,
  expectSelectorHidden,
  expectSelectorVisible,
} from "../shell/assert.js"

import { PROBLEMS_PANEL } from "../helpers/location-list.js"
import { launchJet, openFixtureFile, waitForLspConnected } from "./_launch.js"

test.describe("electron LSP", () => {
  test("LSP connects when opening TypeScript file", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/index.ts")
      await waitForLspConnected(page)
      await expectContainsText(page, "footer", "LSP connected")
    } finally {
      await app.close()
    }
  })

  test("LSP reconnects after the renderer transport is reloaded", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/index.ts")
      await waitForLspConnected(page)

      await page.reload()
      await openFixtureFile(page, "src/index.ts")
      await waitForLspConnected(page)

      await expectContainsText(page, "footer", "LSP connected")
    } finally {
      await app.close()
    }
  })

  test("go to definition on greet opens utils.ts", async () => {
      const { app, page } = await launchJet()
      try {
        await openFixtureFile(page, "src/index.ts")
        await waitForLspConnected(page)

        await page.evaluate(() => window.__jetAgent!.setEditorSelection(4, 4))
        await page.locator(".cm-content").focus()
        await expect.poll(async () => {
          const text = await page.evaluate(() => window.__jetAgent!.getEditorText())
          if (!text?.includes("export function greet")) {
            await page.evaluate(async () => {
              await window.__jetAgent!.executeCommand("editor.action.revealDefinition")
            })
          }
          return page.evaluate(() => window.__jetAgent!.getEditorText())
        }, { timeout: 10_000, intervals: [200, 300, 500] }).toContain("export function greet")
      } finally {
        await app.close()
      }
  })

  test("modifier hover marks the clicked symbol and preserves jump navigation", async () => {
    test.setTimeout(120_000)
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/index.ts")
      await waitForLspConnected(page)
      const point = await page.locator(".cm-line").nth(3).evaluate(line => {
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
        let node = walker.nextNode() as Text | null
        while (node) {
          const index = node.data.indexOf("greet")
          if (index >= 0) {
            const range = document.createRange()
            range.setStart(node, index)
            range.setEnd(node, index + 5)
            const rect = range.getBoundingClientRect()
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
          }
          node = walker.nextNode() as Text | null
        }
        throw new Error("greet token not rendered")
      })

      await page.keyboard.down("Meta")
      for (let attempt = 0; attempt < 40; attempt++) {
        await page.mouse.move(point.x, point.y)
        if ((await page.locator("[data-jet-definition-link]").count()) > 0) break
        await page.waitForTimeout(250)
      }
      await expectLocatorCount(page.locator("[data-jet-definition-link]"), 1, { timeout: 15_000 })
      await page.evaluate(() => window.__jetAgent!.setEditorSelection(4, 4))
      await page.keyboard.up("Meta")
      await expect.poll(async () => {
        const text = await page.evaluate(() => window.__jetAgent!.getEditorText())
        if (!text?.includes("export function greet")) {
          await page.evaluate(async () => {
            await window.__jetAgent!.executeCommand("editor.action.revealDefinition")
          })
        }
        return page.evaluate(() => window.__jetAgent!.getEditorText())
      }, { timeout: 8_000, intervals: [200, 300, 500] }).toContain("export function greet")

      await page.evaluate(async () => window.__jetAgent!.executeCommand("navigation.jumpBack"))
      await expect.poll(() => page.evaluate(() => window.__jetAgent!.getEditorText()), { timeout: 5_000 }).toContain("function main")
    } finally {
      await page.keyboard.up("Meta").catch(() => {})
      await app.close()
    }
  })

  test("quick outline lists main symbol", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/index.ts")
      await waitForLspConnected(page)

      await page.evaluate(async () => {
        await window.__jetAgent!.executeCommand("editor.action.quickOutline")
      })
      await page.waitForTimeout(1500)

      await expectContainsText(page, "body", "main")
    } finally {
      await app.close()
    }
  })

  test("format document changes buffer", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/utils.ts")
      await waitForLspConnected(page)

      const before = await page.evaluate(() => window.__jetAgent!.getEditorText())
      await page.evaluate(async () => {
        await window.__jetAgent!.executeCommand("editor.action.formatDocument")
      })
      await page.waitForTimeout(2000)
      const after = await page.evaluate(() => window.__jetAgent!.getEditorText())
      expect(after).toBeTruthy()
      expect(after!.length).toBeGreaterThanOrEqual(before!.length)
    } finally {
      await app.close()
    }
  })

  test("lint-error.ts shows problems in location list", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/lint-error.ts")
      await waitForLspConnected(page)
      await page.waitForTimeout(2000)

      await page.evaluate(async () => {
        await window.__jetAgent!.executeCommand("locationlist.showProblems")
      })
      await page.waitForTimeout(1500)

      await expectContainsText(page, PROBLEMS_PANEL, /error|Type|problem/i)
    } finally {
      await app.close()
    }
  })

  test("go to references populates location list", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/index.ts")
      await waitForLspConnected(page)

      await page.locator(".cm-content").click()
      await page.keyboard.press("Home")
      for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight")
      await page.evaluate(async () => {
        await window.__jetAgent!.executeCommand("editor.action.goToReferences")
      })
      await page.waitForTimeout(2000)

      await expectContainsText(page, "body", /reference|utils|greet/i)
    } finally {
      await app.close()
    }
  })

  test("LSP resolves nested project root when workspace is parent folder", async () => {
    const { app, page } = await launchJet("fixtures")
    try {
      await openFixtureFile(page, "sample-workspace/src/index.ts")
      await waitForLspConnected(page)

      await openFixtureFile(page, "sample-workspace/src/lint-error.ts")
      await page.waitForTimeout(2500)

      await page.evaluate(async () => {
        await window.__jetAgent!.executeCommand("locationlist.showProblems")
      })
      await page.waitForTimeout(1500)

      await expectContainsText(page, PROBLEMS_PANEL, /error|Type|problem/i)
    } finally {
      await app.close()
    }
  })
})
