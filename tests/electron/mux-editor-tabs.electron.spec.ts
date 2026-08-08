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

  test("keeps Monaco, LSP, and search overlays out of terminal-only startup", async () => {
    const { app, page } = await launchJet()
    try {
      await waitForMux(page)
      const resources = await page.evaluate(() =>
        performance
          .getEntriesByType("resource")
          .map(entry => entry.name.toLowerCase()),
      )
      expect(
        resources.filter(url =>
          /monaco|editor\.api|editor\.worker|muxeditorpane|muxoverlays|quickopen|projectsearch|yaade-lsp/.test(
            url,
          ),
        ),
      ).toEqual([])
      expect(
        await page.evaluate(
          () => window.__yaadeAgent!.getEditorDiagnostics().models.totalCount,
        ),
      ).toBe(0)
    } finally {
      await app.close()
    }
  })

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
      expect(
        model?.owners.some(owner => owner.startsWith("buffer:mux-editor-")),
      ).toBe(true)
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
      await page.keyboard.down("Shift")
      await page.keyboard.press("ArrowLeft")
      await page.keyboard.press("ArrowLeft")
      await page.keyboard.up("Shift")

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
      expect(beforeReload.selections[0]?.startColumn).not.toBe(
        beforeReload.selections[0]?.endColumn,
      )

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

  test("retains one buffer owner per editor group until the final group closes", async () => {
    const { app, page } = await launchJet({ withTerminal: false })
    try {
      await page.evaluate(() => window.__yaadeAgent!.getEditorDiagnostics())
      await page.evaluate(async () => {
        await window.__yaadeAgent!.openFile("src/index.ts")
        await window.__yaadeAgent!.openFileInNewGroup!("src/index.ts")
      })
      const panes = page.locator('[data-yaade-mux-pane-kind="editor"]')
      await expectLocatorCount(panes, 2, { timeout: 15_000 })
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const model = window.__yaadeAgent!
                .getEditorDiagnostics()
                .models.entries.find(entry =>
                  entry.uri.endsWith("/src/index.ts"),
                )
              return model?.owners.filter(owner => owner.startsWith("buffer:"))
                .length ?? 0
            }),
          { timeout: 10_000 },
        )
        .toBe(2)

      await panes.first().click()
      await panes
        .first()
        .locator("[data-yaade-mux-close-pane]")
        .click()
      await expectLocatorCount(panes, 1, { timeout: 10_000 })
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const diagnostics = window.__yaadeAgent!.getEditorDiagnostics()
              const model = diagnostics.models.entries.find(entry =>
                entry.uri.endsWith("/src/index.ts"),
              )
              return {
                open: model?.open,
                bufferOwners:
                  model?.owners.filter(owner => owner.startsWith("buffer:"))
                    .length ?? 0,
                openBuffers: diagnostics.editors.openBuffers,
              }
            }),
          { timeout: 10_000 },
        )
        .toMatchObject({
          open: true,
          bufferOwners: 1,
          openBuffers: [expect.stringMatching(/\/src\/index\.ts$/)],
        })
    } finally {
      await app.close()
    }
  })

  test("Save As promotes an untitled buffer only after atomic create", async () => {
    const { app, page } = await launchJet({ withTerminal: false })
    try {
      await page.evaluate(() =>
        window.__yaadeAgent!.openFile("untitled:Save-As-E2E.ts"),
      )
      await expectSelectorVisible(page, "[data-yaade-monaco-editor]", {
        timeout: 15_000,
      })
      const input = page.locator(
        "[data-yaade-monaco-editor] textarea.inputarea",
      )
      await input.focus()
      await page.keyboard.type("export const savedAs = true")
      const before = await page.evaluate(() => {
        const editor = window.__yaadeAgent!
          .getEditorDiagnostics()
          .editors.entries.find(entry => entry.uri.startsWith("untitled:"))
        return editor
          ? { position: editor.position, selections: editor.selections }
          : null
      })

      await execCommand(page, "editor.saveAs")
      const dialog = page.getByRole("dialog").filter({ hasText: "Save As" })
      await expect(dialog).toBeVisible()
      const root = await page.evaluate(
        () => window.__yaadeAgent!.getState().workspace,
      )
      if (!root) throw new Error("workspace unavailable")
      await dialog.locator("input").fill(`${root}/saved-as-e2e.ts`)
      await dialog.locator("input").press(`${modChord()}+Enter`)

      await expect
        .poll(
          () =>
            page
              .locator("[data-yaade-mux-editor-pane]")
              .getAttribute("data-yaade-mux-editor-uri"),
          { timeout: 15_000 },
        )
        .toMatch(/\/saved-as-e2e\.ts$/)
      const result = await page.evaluate(async () => {
        const workspace = window.__yaadeAgent!.getState().workspace
        if (!workspace) throw new Error("workspace unavailable")
        const uri = `file://${workspace}/saved-as-e2e.ts`
        const diagnostics = window.__yaadeAgent!.getEditorDiagnostics()
        const editor = diagnostics.editors.entries.find(
          entry => entry.uri === uri,
        )
        return {
          content: (await window.yaade!.fs.readTextFile(uri)).content,
          activeDirty: diagnostics.editors.activeDirty,
          position: editor?.position,
          selections: editor?.selections,
          openBuffers: diagnostics.editors.openBuffers,
        }
      })
      expect(result).toMatchObject({
        content: "export const savedAs = true",
        activeDirty: false,
        position: before?.position,
        selections: before?.selections,
        openBuffers: [expect.stringMatching(/\/saved-as-e2e\.ts$/)],
      })
    } finally {
      await app.close()
    }
  })

  test("restores dirty and untitled recovery automatically after reload", async () => {
    const { app, page } = await launchJet({ withTerminal: false })
    try {
      await page.evaluate(() =>
        window.__yaadeAgent!.openFile("untitled:Recovery-E2E.ts"),
      )
      await expectSelectorVisible(page, "[data-yaade-monaco-editor]", {
        timeout: 15_000,
      })
      const input = page.locator(
        "[data-yaade-monaco-editor] textarea.inputarea",
      )
      await input.focus()
      await page.keyboard.type("const recoveredAfterReload = 42")
      await page.waitForTimeout(1_200)

      await page.reload()
      await waitForMux(page)
      await expectSelectorVisible(page, "[data-yaade-monaco-editor]", {
        timeout: 15_000,
      })
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const diagnostics = window.__yaadeAgent!.getEditorDiagnostics()
              const recovered = diagnostics.models.entries.find(entry =>
                entry.uri.startsWith("untitled:Recovery-E2E.ts"),
              )
              return {
                dirty: diagnostics.editors.activeDirty,
                content: recovered?.content ?? "",
              }
            }),
          { timeout: 15_000 },
        )
        .toEqual({
          dirty: true,
          content: "const recoveredAfterReload = 42",
        })
    } finally {
      await app.close()
    }
  })

  test("restored disk conflicts offer Compare, Keep Mine, and Reload", async () => {
    const { app, page } = await launchJet({ withTerminal: false })
    try {
      const uri = await page.evaluate(async () => {
        const root = window.__yaadeAgent!.getState().workspace
        if (!root) throw new Error("workspace unavailable")
        const target = `file://${root}/recovery-conflict-e2e.ts`
        await window.yaade!.fs.writeTextFile(target, "disk version one", {
          create: true,
        })
        await window.__yaadeAgent!.openFile(target)
        return target
      })
      await expectSelectorVisible(page, "[data-yaade-monaco-editor]", {
        timeout: 15_000,
      })
      const input = page.locator(
        "[data-yaade-monaco-editor] textarea.inputarea",
      )
      await input.focus()
      await page.keyboard.press(`${modChord()}+a`)
      await page.keyboard.type("my recovered version")
      await page.waitForTimeout(1_000)
      await page.evaluate(async target => {
        const current = await window.yaade!.fs.readTextFile(target)
        await window.yaade!.fs.writeTextFile(target, "disk version two", {
          expectedVersion: current.version,
        })
      }, uri)
      await page.waitForTimeout(800)

      await page.reload()
      await waitForMux(page)
      const conflict = page.locator('[data-yaade-editor-conflict="true"]')
      await expect(conflict).toBeVisible({ timeout: 15_000 })
      await expect(conflict.getByRole("button", { name: "Compare" })).toBeVisible()
      await expect(conflict.getByRole("button", { name: "Keep Mine" })).toBeVisible()
      await expect(conflict.getByRole("button", { name: "Reload" })).toBeVisible()

      await conflict.getByRole("button", { name: "Compare" }).click()
      const compareDialog = page
        .getByRole("dialog")
        .filter({ hasText: "Recovered changes" })
      await expect(compareDialog).toBeVisible()
      await expectSelectorVisible(page, "[data-yaade-monaco-diff-editor]", {
        timeout: 15_000,
      })
      await page.keyboard.press("Escape")

      await conflict.getByRole("button", { name: "Reload" }).click()
      await expect(conflict).toHaveCount(0)
      await expect
        .poll(
          () =>
            page.evaluate(target => {
              const diagnostics = window.__yaadeAgent!.getEditorDiagnostics()
              return {
                dirty: diagnostics.editors.activeDirty,
                content:
                  diagnostics.models.entries.find(entry => entry.uri === target)
                    ?.content ?? "",
              }
            }, uri),
          { timeout: 10_000 },
        )
        .toEqual({ dirty: false, content: "disk version two" })
    } finally {
      await app.close()
    }
  })

  test("dirty close supports Cancel and Discard All without losing control", async () => {
    const { app, page } = await launchJet({ withTerminal: false })
    try {
      await page.evaluate(() => window.__yaadeAgent!.openFile("src/index.ts"))
      await expectSelectorVisible(page, "[data-yaade-monaco-editor]", {
        timeout: 15_000,
      })
      const input = page.locator(
        "[data-yaade-monaco-editor] textarea.inputarea",
      )
      await input.focus()
      await page.keyboard.press(`${modChord()}+ArrowDown`)
      await page.keyboard.type("\n// discard-close-sentinel")

      const activeTab = page.locator(
        '[data-yaade-modal-editor-tab][data-active]',
      )
      await activeTab.locator('button[aria-label^="Close"]').click()
      await expectSelectorVisible(page, '[data-yaade-confirm="accept"]')
      await page.locator('[data-yaade-confirm="cancel"]').click()
      await expectLocatorCount(
        page.locator("[data-yaade-modal-editor-tabs] [role='tab']"),
        1,
      )
      expect(
        await page.evaluate(
          () => window.__yaadeAgent!.getEditorDiagnostics().editors.activeDirty,
        ),
      ).toBe(true)

      await activeTab.locator('button[aria-label^="Close"]').click()
      await expectSelectorVisible(page, '[data-yaade-confirm="alternate"]')
      await page.locator('[data-yaade-confirm="alternate"]').click()
      await expectLocatorCount(
        page.locator("[data-yaade-modal-editor-tabs] [role='tab']"),
        0,
        { timeout: 10_000 },
      )

      await page.evaluate(() => window.__yaadeAgent!.openFile("src/index.ts"))
      await expectSelectorVisible(page, "[data-yaade-monaco-editor]", {
        timeout: 15_000,
      })
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const model = window.__yaadeAgent!
                .getEditorDiagnostics()
                .models.entries.find(entry =>
                  entry.uri.endsWith("/src/index.ts"),
                )
              return model?.content ?? ""
            }),
          { timeout: 10_000 },
        )
        .not.toContain("discard-close-sentinel")
    } finally {
      await app.close()
    }
  })

  test("dirty close Save All persists before closing the tab", async () => {
    const { app, page } = await launchJet({ withTerminal: false })
    try {
      await page.evaluate(() => window.__yaadeAgent!.openFile("src/index.ts"))
      await expectSelectorVisible(page, "[data-yaade-monaco-editor]", {
        timeout: 15_000,
      })
      const input = page.locator(
        "[data-yaade-monaco-editor] textarea.inputarea",
      )
      await input.focus()
      await page.keyboard.press(`${modChord()}+ArrowDown`)
      await page.keyboard.type("\n// save-close-sentinel")
      await page
        .locator(
          '[data-yaade-modal-editor-tab][data-active] button[aria-label^="Close"]',
        )
        .click()
      await expectSelectorVisible(page, '[data-yaade-confirm="accept"]')
      await page.locator('[data-yaade-confirm="accept"]').click()
      await expectLocatorCount(
        page.locator("[data-yaade-modal-editor-tabs] [role='tab']"),
        0,
        { timeout: 10_000 },
      )
      const content = await page.evaluate(async () => {
        const root = window.__yaadeAgent!.getState().workspace
        if (!root) throw new Error("workspace unavailable")
        return window.yaade!.fs.readFile(`file://${root}/src/index.ts`)
      })
      expect(content).toContain("save-close-sentinel")
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
