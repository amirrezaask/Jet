import { expect, test } from "@playwright/test"
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { dragResizeHandle, expectListRows } from "../helpers/list.js"
import {
  expectLocatorContainsText,
  expectLocatorCount,
  expectSelectorVisible,
} from "../shell/assert.js"
import {
  execCommand,
  hasPtySpawn,
  launchJet,
  pressMod,
  REPO_ROOT,
  SAMPLE,
} from "./_launch.js"

test.describe("editor project search", () => {
  test.skip(!hasPtySpawn(), "PTY support is required to open a session workspace")

  test("searches through the fff-backed host service and opens a result in Monaco", async () => {
    const { app, page } = await launchJet()
    try {
      await execCommand(page, "terminal.new")
      await expectSelectorVisible(page, "[data-gharargah-terminal-modal]", {
        timeout: 20_000,
      })
      await page.locator('[data-gharargah-session-mode-tab="editor"]').click()
      await expectSelectorVisible(page, "[data-gharargah-modal-editor]")

      await pressMod(page, "f", { shift: true })
      await expectSelectorVisible(page, "[data-gharargah-editor-project-search]")
      await expectSelectorVisible(
        page,
        "[data-gharargah-editor-project-search-drawer]",
      )
      const input = page.locator('input[aria-label="Search project"]')
      await expect
        .poll(() => input.evaluate(element => element === document.activeElement))
        .toBe(true)

      const searchPanel = page.locator("[data-gharargah-editor-project-search]")
      const editorContent = page.locator("[data-gharargah-modal-editor-content]")
      const resizeHandle = page.locator(
        "[data-gharargah-editor-project-search-resize]",
      )
      await expect.poll(() => resizeHandle.getAttribute("role")).toBe("separator")

      const initialSearchBox = await searchPanel.boundingBox()
      const initialEditorBox = await editorContent.boundingBox()
      expect(initialSearchBox).not.toBeNull()
      expect(initialEditorBox).not.toBeNull()
      expect(initialSearchBox!.height).toBeGreaterThanOrEqual(159)
      expect(initialEditorBox!.height).toBeGreaterThanOrEqual(239)
      expect(initialSearchBox!.y).toBeGreaterThanOrEqual(
        initialEditorBox!.y + initialEditorBox!.height - 2,
      )

      await dragResizeHandle(page, {
        selector: "[data-gharargah-editor-project-search-resize]",
        // Drag handle upward into the editor to grow the bottom search drawer.
        deltaY: -120,
      })

      const grownSearchBox = await searchPanel.boundingBox()
      const shrunkEditorBox = await editorContent.boundingBox()
      expect(grownSearchBox).not.toBeNull()
      expect(shrunkEditorBox).not.toBeNull()
      expect(grownSearchBox!.height).toBeGreaterThan(initialSearchBox!.height + 80)
      expect(shrunkEditorBox!.height).toBeLessThan(initialEditorBox!.height - 80)
      expect(shrunkEditorBox!.height).toBeGreaterThanOrEqual(239)
      expect(grownSearchBox!.y).toBeGreaterThanOrEqual(
        shrunkEditorBox!.y + shrunkEditorBox!.height - 2,
      )

      await dragResizeHandle(page, {
        selector: "[data-gharargah-editor-project-search-resize]",
        // Drag handle downward into the search drawer to hit its min height.
        deltaY: 1_000,
      })

      const minimumSearchBox = await searchPanel.boundingBox()
      const expandedEditorBox = await editorContent.boundingBox()
      expect(minimumSearchBox).not.toBeNull()
      expect(expandedEditorBox).not.toBeNull()
      expect(minimumSearchBox!.height).toBeGreaterThanOrEqual(159)
      expect(minimumSearchBox!.height).toBeLessThanOrEqual(168)
      expect(expandedEditorBox!.height).toBeGreaterThanOrEqual(239)
      expect(minimumSearchBox!.y).toBeGreaterThanOrEqual(
        expandedEditorBox!.y + expandedEditorBox!.height - 2,
      )

      const caseToggle = searchPanel.getByRole("button", { name: "Case" })
      await caseToggle.click()
      await expect.poll(() => caseToggle.getAttribute("data-state")).toBe("on")
      await caseToggle.click()
      await expect.poll(() => caseToggle.getAttribute("data-state")).toBe("off")
      await expect
        .poll(() => input.evaluate(element => (element as HTMLInputElement).value))
        .toBe("")

      await input.fill("greet")

      await expectListRows(page, {
        panel: "editor-project-search",
        minItems: 3,
        needle: "src/utils.ts:1:",
        noResultsText: "No results",
      })

      const result = page
        .locator(
          '[data-gharargah-list-panel="editor-project-search"] [data-gharargah-list-item]',
        )
        .filter({ hasText: "src/utils.ts:1:" })
        .first()
      await result.click()

      await expectSelectorVisible(page, "[data-gharargah-monaco-editor]", {
        timeout: 20_000,
      })
      await expectLocatorContainsText(
        page.locator("[data-gharargah-modal-editor-tab][data-active]"),
        "utils.ts",
      )
      await expectLocatorContainsText(
        page.locator("[data-gharargah-editor-cursor]"),
        "Ln 1",
      )

      await page.getByRole("button", { name: "Close project search" }).click()
      await expectLocatorCount(
        page.locator("[data-gharargah-editor-project-search]"),
        0,
      )
      await expectSelectorVisible(page, "[data-gharargah-monaco-editor]")
    } finally {
      await app.close()
    }
  })

  test("a clean external file reload stays clean after Monaco receives the new text", async () => {
    const root = mkdtempSync(join(tmpdir(), "gharargah-editor-reload-"))
    const workspace = join(root, "workspace")
    cpSync(join(REPO_ROOT, SAMPLE), workspace, { recursive: true })
    const file = join(workspace, "src/index.ts")
    const watchProbe = join(workspace, "watch-probe.txt")
    const { app, page } = await launchJet(workspace)
    try {
      await execCommand(page, "terminal.new")
      await expectSelectorVisible(page, "[data-gharargah-terminal-modal]", {
        timeout: 20_000,
      })
      await page.locator('[data-gharargah-session-mode-tab="editor"]').click()
      await page.evaluate(() => window.__gharargahAgent!.openFile("src/index.ts"))
      await expectSelectorVisible(page, "[data-gharargah-monaco-editor]", {
        timeout: 20_000,
      })
      await expectLocatorCount(page.locator("[data-gharargah-buffer-dirty]"), 0)

      await page.evaluate(() => {
        const state = window as Window & { __editorWatchReady?: boolean }
        state.__editorWatchReady = false
        window.gharargah?.fs.onFileChanged?.(uri => {
          if (uri.endsWith("/watch-probe.txt")) state.__editorWatchReady = true
        })
      })
      let probeRevision = 0
      await expect
        .poll(
          async () => {
            writeFileSync(watchProbe, `probe ${probeRevision++}\n`)
            return page.evaluate(
              () =>
                Boolean(
                  (window as Window & { __editorWatchReady?: boolean })
                    .__editorWatchReady,
                ),
            )
          },
          { timeout: 20_000, intervals: [500] },
        )
        .toBe(true)

      const next = `${readFileSync(file, "utf8")}\n// external-clean-reload\n`
      writeFileSync(file, next)

      await expectLocatorContainsText(
        page.locator("[data-gharargah-monaco-editor] .view-lines"),
        "external-clean-reload",
        { timeout: 20_000 },
      )
      await expectLocatorCount(
        page.locator("[data-gharargah-buffer-dirty]"),
        0,
        { timeout: 20_000 },
      )
      await expectLocatorContainsText(
        page.locator("[data-gharargah-modal-editor-status]"),
        "typescript",
      )
    } finally {
      await app.close()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
