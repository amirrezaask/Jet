import { expect, test } from "@playwright/test"
import {
  expectLocatorContainsText,
  expectLocatorCount,
  expectSelectorVisible,
} from "../shell/assert.js"
import {
  execCommand,
  hasPtySpawn,
  launchJet,
  modChord,
  waitForMux,
} from "./_launch.js"

test.describe("mux editor tabs", () => {
  test.skip(!hasPtySpawn(), "node-pty spawn unavailable")

  test("exposes cumulative editor diagnostics without changing editor state", async () => {
    const { app, page } = await launchJet({ withTerminal: false })
    try {
      const baseline = await page.evaluate(() =>
        window.__yaadeAgent!.getEditorDiagnostics(),
      )
      expect(baseline.models.totalCount).toBe(0)
      expect(baseline.fsReads.totalCount).toBe(0)

      await page.evaluate(async () => {
        await window.__yaadeAgent!.openFile("src/index.ts")
      })
      await expectSelectorVisible(page, "[data-yaade-monaco-editor]", {
        timeout: 15_000,
      })
      await page.locator("[data-yaade-monaco-editor]").click()

      await expect
        .poll(
          () => page.evaluate(() => window.__yaadeAgent!.getEditorDiagnostics()),
          { timeout: 10_000 },
        )
        .toMatchObject({
          models: { totalCount: 1 },
          editors: { mountedCount: 1, activeDirty: false },
          fsReads: { totalCount: 1, errorCount: 0 },
        })
      const snapshot = await page.evaluate(() => {
        const value = window.__yaadeAgent!.getEditorDiagnostics()
        return { value, serialized: JSON.stringify(value) }
      })
      const model = snapshot.value.models.entries.find(entry =>
        entry.uri.endsWith("/src/index.ts"),
      )
      expect(model).toMatchObject({
        refCount: 2,
        ownerCount: 2,
        lspOwnerCount: 0,
        open: true,
        dirty: false,
        pinned: true,
      })
      expect(model?.owners).toContain(`buffer:${model.uri}`)
      expect(model?.owners.some(owner => owner.startsWith("view:"))).toBe(true)
      expect(model?.version).toBeGreaterThan(0)
      expect(model?.bytes).toBeGreaterThan(0)
      expect(model?.lines).toBeGreaterThan(0)
      expect(model?.content).toContain("main()")
      expect(snapshot.value.editors.activeUri).toMatch(/\/src\/index\.ts$/)
      expect(snapshot.value.editors.openBuffers).toContain(model?.uri)
      expect(snapshot.value.lifecycle.mounts).toBeGreaterThan(0)
      expect(snapshot.value.lifecycle.modelAttaches).toBeGreaterThan(0)
      expect(snapshot.value.chunks.length).toBeGreaterThan(0)
      expect(snapshot.value.resources.totalCount).toBeGreaterThan(0)
      expect(snapshot.value.fsReads.byUri).toContainEqual(
        expect.objectContaining({ uri: model?.uri, count: 1 }),
      )
      expect(snapshot.serialized.length).toBeGreaterThan(0)
    } finally {
      await app.close()
    }
  })

  test("openFile opens tabs in one editor pane, not new splits", async () => {
    const { app, page } = await launchJet()
    try {
      await waitForMux(page)

      await page.evaluate(async () => {
        await window.__yaadeAgent!.openFile("src/index.ts")
      })
      await expectSelectorVisible(page, "[data-yaade-mux-editor-pane]", {
        timeout: 15_000,
      })
      await expectSelectorVisible(page, "[data-yaade-monaco-editor]", {
        timeout: 15_000,
      })

      await expectLocatorCount(
        page.locator('[data-yaade-mux-pane-kind="editor"]'),
        1,
      )
      await expectLocatorCount(
        page.locator("[data-yaade-modal-editor-tabs] [role='tab']"),
        1,
      )

      await page.evaluate(async () => {
        await window.__yaadeAgent!.openFile("src/utils.ts")
      })
      await expectLocatorCount(
        page.locator("[data-yaade-modal-editor-tabs] [role='tab']"),
        2,
        { timeout: 10_000 },
      )
      await expectLocatorCount(
        page.locator('[data-yaade-mux-pane-kind="editor"]'),
        1,
      )
      await expect
        .poll(async () => {
          const uri = await page
            .locator("[data-yaade-mux-editor-uri]")
            .evaluate(el => el.getAttribute("data-yaade-mux-editor-uri") ?? "")
          return /utils\.ts/.test(uri)
        }, { timeout: 10_000 })
        .toBe(true)

      await page.evaluate(async () => {
        await window.__yaadeAgent!.openFile("src/index.ts")
      })
      await expectLocatorCount(
        page.locator("[data-yaade-modal-editor-tabs] [role='tab']"),
        2,
      )
      await expectLocatorCount(
        page.locator('[data-yaade-mux-pane-kind="editor"]'),
        1,
      )
      await expect
        .poll(async () => {
          const uri = await page
            .locator("[data-yaade-mux-editor-uri]")
            .evaluate(el => el.getAttribute("data-yaade-mux-editor-uri") ?? "")
          return /index\.ts/.test(uri)
        }, { timeout: 10_000 })
        .toBe(true)
    } finally {
      await app.close()
    }
  })

  test("retains unsaved text across tab switches without rereading files", async () => {
    const { app, page } = await launchJet({ withTerminal: false })
    try {
      await page.evaluate(() => window.__yaadeAgent!.getEditorDiagnostics())
      await page.evaluate(() => window.__yaadeAgent!.openFile("src/index.ts"))
      await expectSelectorVisible(page, "[data-yaade-monaco-editor]", {
        timeout: 15_000,
      })

      const input = page.locator(
        "[data-yaade-monaco-editor] textarea.inputarea",
      )
      await input.focus()
      await page.keyboard.press(`${modChord()}+ArrowDown`)
      await page.keyboard.type("\n// unsaved-buffer-sentinel")
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const diagnostics = window.__yaadeAgent!.getEditorDiagnostics()
              return {
                dirty: diagnostics.editors.activeDirty,
                content:
                  diagnostics.models.entries.find(entry =>
                    entry.uri.endsWith("/src/index.ts"),
                  )?.content ?? "",
              }
            }),
          { timeout: 10_000 },
        )
        .toEqual({
          dirty: true,
          content: expect.stringContaining("// unsaved-buffer-sentinel"),
        })

      await page.evaluate(() => window.__yaadeAgent!.openFile("src/utils.ts"))
      await expect
        .poll(
          () =>
            page.locator("[data-yaade-mux-editor-pane]").getAttribute(
              "data-yaade-mux-editor-uri",
            ),
          { timeout: 10_000 },
        )
        .toMatch(/\/src\/utils\.ts$/)

      await page.evaluate(() => window.__yaadeAgent!.openFile("src/index.ts"))
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const diagnostics = window.__yaadeAgent!.getEditorDiagnostics()
              const index = diagnostics.models.entries.find(entry =>
                entry.uri.endsWith("/src/index.ts"),
              )
              const utils = diagnostics.models.entries.find(entry =>
                entry.uri.endsWith("/src/utils.ts"),
              )
              return {
                activeUri: diagnostics.editors.activeUri,
                activeDirty: diagnostics.editors.activeDirty,
                indexContent: index?.content ?? "",
                indexOwners: index?.owners ?? [],
                utilsOwners: utils?.owners ?? [],
                indexReads:
                  diagnostics.fsReads.byUri.find(entry =>
                    entry.uri.endsWith("/src/index.ts"),
                  )?.count ?? 0,
                utilsReads:
                  diagnostics.fsReads.byUri.find(entry =>
                    entry.uri.endsWith("/src/utils.ts"),
                  )?.count ?? 0,
              }
            }),
          { timeout: 10_000 },
        )
        .toMatchObject({
          activeUri: expect.stringMatching(/\/src\/index\.ts$/),
          activeDirty: true,
          indexContent: expect.stringContaining("// unsaved-buffer-sentinel"),
          indexOwners: expect.arrayContaining([
            expect.stringMatching(/^buffer:/),
            expect.stringMatching(/^view:/),
          ]),
          utilsOwners: [expect.stringMatching(/^buffer:/)],
          indexReads: 1,
          utilsReads: 1,
        })
    } finally {
      await app.close()
    }
  })

  test("restores exact editor view state after tab switches and session reload", async () => {
    const { app, page } = await launchJet({ withTerminal: false })
    try {
      await page.evaluate(() => window.__yaadeAgent!.getEditorDiagnostics())
      await page.evaluate(() => window.__yaadeAgent!.openFile("src/index.ts"))
      await expectSelectorVisible(page, "[data-yaade-monaco-editor]", {
        timeout: 15_000,
      })

      const input = page.locator(
        "[data-yaade-monaco-editor] textarea.inputarea",
      )
      await input.focus()
      await page.keyboard.press(`${modChord()}+ArrowDown`)
      await page.keyboard.press("ArrowLeft")

      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const editor = window.__yaadeAgent!
                .getEditorDiagnostics()
                .editors.entries.find(entry =>
                  entry.uri.endsWith("/src/index.ts"),
                )
              return editor
                ? {
                    position: editor.position,
                    selections: editor.selections,
                    scrollTop: editor.scrollTop,
                    scrollLeft: editor.scrollLeft,
                  }
                : null
            }),
          { timeout: 10_000 },
        )
        .not.toBeNull()
      const beforeReload = await page.evaluate(() => {
        const editor = window.__yaadeAgent!
          .getEditorDiagnostics()
          .editors.entries.find(entry => entry.uri.endsWith("/src/index.ts"))
        if (!editor) throw new Error("index editor diagnostics unavailable")
        return {
          position: editor.position,
          selections: editor.selections,
          scrollTop: editor.scrollTop,
          scrollLeft: editor.scrollLeft,
        }
      })
      expect(beforeReload.position?.line).toBeGreaterThan(1)

      await page.evaluate(() => window.__yaadeAgent!.openFile("src/utils.ts"))
      await expect
        .poll(
          () =>
            page.locator("[data-yaade-mux-editor-pane]").getAttribute(
              "data-yaade-mux-editor-uri",
            ),
          { timeout: 10_000 },
        )
        .toMatch(/\/src\/utils\.ts$/)
      await page.waitForTimeout(900)

      await page.reload()
      await waitForMux(page)
      await page.evaluate(() => window.__yaadeAgent!.openFile("src/index.ts"))
      await expectSelectorVisible(page, "[data-yaade-monaco-editor]", {
        timeout: 15_000,
      })

      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const editor = window.__yaadeAgent!
                .getEditorDiagnostics()
                .editors.entries.find(entry =>
                  entry.uri.endsWith("/src/index.ts"),
                )
              return editor
                ? {
                    position: editor.position,
                    selections: editor.selections,
                    scrollTop: editor.scrollTop,
                    scrollLeft: editor.scrollLeft,
                  }
                : null
            }),
          { timeout: 15_000 },
        )
        .toEqual(beforeReload)
    } finally {
      await app.close()
    }
  })

  test("close buffer tab keeps pane until last tab; close pane removes group", async () => {
    const { app, page } = await launchJet()
    try {
      await waitForMux(page)

      await page.evaluate(async () => {
        await window.__yaadeAgent!.openFile("src/index.ts")
        await window.__yaadeAgent!.openFile("src/utils.ts")
      })
      await expectLocatorCount(
        page.locator("[data-yaade-modal-editor-tabs] [role='tab']"),
        2,
        { timeout: 15_000 },
      )

      await expectLocatorContainsText(
        page.locator('[data-yaade-modal-editor-tab][data-active] [role="tab"]'),
        "utils.ts",
      )
      await page
        .locator(
          '[data-yaade-modal-editor-tab][data-active] button[aria-label^="Close"]',
        )
        .click()

      await expectLocatorCount(
        page.locator("[data-yaade-modal-editor-tabs] [role='tab']"),
        1,
        { timeout: 10_000 },
      )
      await expectLocatorCount(
        page.locator('[data-yaade-mux-pane-kind="editor"]'),
        1,
      )

      // Focus the editor group, then close the whole pane (not a single buffer).
      await page.locator('[data-yaade-mux-pane-kind="editor"]').click()
      await page
        .locator('[data-yaade-mux-pane-kind="editor"] [data-yaade-mux-close-pane]')
        .click()
      await expectLocatorCount(
        page.locator('[data-yaade-mux-pane-kind="editor"]'),
        0,
        { timeout: 10_000 },
      )
      await expectLocatorCount(page.locator("[data-yaade-mux-editor-pane]"), 0)
    } finally {
      await app.close()
    }
  })

  test("quick open places a file as an editor tab", async () => {
    const { app, page } = await launchJet()
    try {
      await waitForMux(page)
      await execCommand(page, "editor.quickOpen")
      const input = page.locator(
        '[role="dialog"] input, [data-yaade-palette] input',
      )
      await expectSelectorVisible(page, "[data-yaade-palette], [role='dialog']", {
        timeout: 10_000,
      })
      await input.first().fill("index.ts")
      await page.waitForTimeout(400)
      await page.keyboard.press("Enter")

      await expectSelectorVisible(page, "[data-yaade-mux-editor-pane]", {
        timeout: 15_000,
      })
      await expectLocatorCount(
        page.locator('[data-yaade-mux-pane-kind="editor"]'),
        1,
      )
      await expectLocatorCount(
        page.locator("[data-yaade-modal-editor-tabs] [role='tab']"),
        1,
      )
    } finally {
      await app.close()
    }
  })

  test("OS file-drop listeners install; drop opens file in monaco", async () => {
    const { app, page } = await launchJet({ withTerminal: false })
    try {
      await waitForMux(page)

      await expect
        .poll(
          async () =>
            page.evaluate(() => Boolean(window.__yaadeOsFileDropInstalled)),
          { timeout: 10_000 },
        )
        .toBe(true)

      const dropped = await page.evaluate(async () => {
        const root = window.__yaadeAgent!.getState().workspace
        if (!root) throw new Error("no workspace")
        const path = `${root}/src/utils.ts`
        const ok = await window.__yaadeAgent!.dropFilesOnEditor([path])
        return { ok, path }
      })
      expect(dropped.ok).toBe(true)

      await expectSelectorVisible(page, "[data-yaade-monaco-editor]", {
        timeout: 15_000,
      })
      await expect
        .poll(async () => {
          const uri = await page
            .locator("[data-yaade-mux-editor-uri]")
            .evaluate(el => el.getAttribute("data-yaade-mux-editor-uri") ?? "")
          return /utils\.ts/.test(uri)
        }, { timeout: 10_000 })
        .toBe(true)
    } finally {
      await app.close()
    }
  })
})
