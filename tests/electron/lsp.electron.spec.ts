import { expect, test } from "@playwright/test"
import { PROBLEMS_PANEL } from "../helpers/location-list.js"
import { launchJet, openFixtureFile, waitForLspConnected, hasTypescriptLanguageServer } from "./_launch.js"

const lspAvailable = hasTypescriptLanguageServer()

test.describe("electron LSP", () => {
  test.skip(!lspAvailable, "typescript-language-server not on PATH")

  test("LSP connects when opening TypeScript file", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/index.ts")
      await waitForLspConnected(page)
      await expect(page.locator("footer")).toContainText("LSP connected")
    } finally {
      await app.close()
    }
  })

  test("go to definition on greet opens utils.ts", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/index.ts")
      await waitForLspConnected(page)

      await page.locator(".cm-content").click()
      await page.keyboard.press("Home")
      for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight")
      await page.keyboard.press("F12")
      await page.waitForTimeout(2000)

      await expect(page.locator(".cm-editor")).toContainText("export function greet")
    } finally {
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

      await expect(page.locator("body")).toContainText("main")
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

      await expect(page.locator(PROBLEMS_PANEL)).toContainText(/error|Type|problem/i)
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

      await expect(page.locator(PROBLEMS_PANEL)).toContainText(/error|Type|problem/i)
    } finally {
      await app.close()
    }
  })
})
