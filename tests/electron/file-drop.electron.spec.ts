import { expect, test } from "@playwright/test"

import { hasPtySpawn, launchJet, openFixtureFile, showTerminal } from "./_launch.js"

const ptyAvailable = hasPtySpawn()

test.describe("file drag and drop", () => {
  test("dropping a file on the editor opens it instead of inserting content", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/index.ts")
      const workspacePath = await page.evaluate(() => window.__gharargahAgent!.getState().activeWorkspace!)
      const utilsPath = `${workspacePath}/src/utils.ts`

      await page.evaluate(utils => {
        const editor = document.querySelector("[data-gharargah-editor-scroll-area]")
        if (!editor) throw new Error("editor surface missing")
        const dt = new DataTransfer()
        const file = new File([""], "utils.ts")
        Object.defineProperty(file, "path", { value: utils, configurable: true })
        dt.items.add(file)
        editor.dispatchEvent(
          new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }),
        )
      }, utilsPath)

      await expect
        .poll(() => page.evaluate(() => window.__gharargahAgent!.getState().openBuffers))
        .toContainEqual(expect.stringMatching(/utils\.ts$/))

      const editorText = await page.evaluate(() => window.__gharargahAgent!.getEditorText())
      expect(editorText).toContain("export function greet")
      expect(editorText).not.toContain("function main")
    } finally {
      await app.close()
    }
  })

  test.skip(!ptyAvailable, "node-pty cannot spawn a shell on this machine")

  test("dropping a file on the terminal pastes its path", async () => {
    const { app, page } = await launchJet()
    try {
      await showTerminal(page)
      await page.waitForFunction(
        () => {
          const id = document
            .querySelector("[data-gharargah-terminal-panel]")
            ?.getAttribute("data-gharargah-terminal-pty-id")
          return !!id && id.length > 0
        },
        null,
        { timeout: 30_000 },
      )

      const written = await page.evaluate(async () => {
        const terminal = window.gharargah?.terminal
        const workspacePath = window.__gharargahAgent?.getState().activeWorkspace
        const panel = document.querySelector("[data-gharargah-terminal-panel]")
        const ptyId = panel?.getAttribute("data-gharargah-terminal-pty-id")
        if (!terminal || !workspacePath || !panel || !ptyId) {
          throw new Error("terminal drop prerequisites missing")
        }

        const filePath = `${workspacePath}/src/index.ts`
        let captured = ""
        const original = terminal.write.bind(terminal)
        ;(terminal as { write: typeof original }).write = async (id, data) => {
          if (id === ptyId) captured += data
          return original(id, data)
        }

        const dt = new DataTransfer()
        const file = new File([""], "index.ts")
        Object.defineProperty(file, "path", { value: filePath, configurable: true })
        dt.items.add(file)
        panel.dispatchEvent(
          new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }),
        )

        await new Promise(resolve => window.setTimeout(resolve, 50))
        ;(terminal as { write: typeof original }).write = original
        return captured
      })

      expect(written).toContain("src/index.ts")
      expect(written).not.toContain("export function")
    } finally {
      await app.close()
    }
  })
})
