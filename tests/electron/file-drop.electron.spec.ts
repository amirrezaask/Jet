import { expect, test } from "@playwright/test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { expectLocatorVisible } from "../shell/assert.js"
import {
  focusTerminal,
  hasPtySpawn,
  launchJet,
  readTerminalText,
  showTerminal,
} from "./_launch.js"

const ptyAvailable = hasPtySpawn()

async function dispatchFileDrop(
  page: Awaited<ReturnType<typeof launchJet>>["page"],
  selector: string,
  absPath: string,
  contents = "drop-fixture\n",
): Promise<boolean> {
  return page.evaluate(
    ({ sel, path, body }) => {
      const el = document.querySelector(sel)
      if (!el) return false
      const rect = el.getBoundingClientRect()
      const name = path.split("/").pop() || "drop.txt"
      const file = new File([body], name, { type: "text/plain" })
      Object.defineProperty(file, "path", { value: path })
      const dt = new DataTransfer()
      dt.items.add(file)
      dt.setData("text/uri-list", `file://${path}`)
      const opts: DragEventInit = {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        dataTransfer: dt,
      }
      el.dispatchEvent(new DragEvent("dragenter", opts))
      el.dispatchEvent(new DragEvent("dragover", opts))
      el.dispatchEvent(new DragEvent("drop", opts))
      return true
    },
    { sel: selector, path: absPath, body: contents },
  )
}

test.describe("file drag and drop", () => {
  test.skip(!ptyAvailable, "node-pty cannot spawn a shell on this machine")

  test("drops a file path into the terminal PTY via HTML5 DnD", async () => {
    const { app, page } = await launchJet()
    try {
      await showTerminal(page)
      await focusTerminal(page)
      const workspace = await page.evaluate(() => window.__gharargahAgent!.getState().activeWorkspace)
      expect(workspace).toBeTruthy()
      const dropPath = join(workspace!, "dnd-terminal-drop.txt")
      writeFileSync(dropPath, "terminal-drop-body\n")
      const needle = "dnd-terminal-drop.txt"
      const ok = await dispatchFileDrop(
        page,
        "[data-gharargah-terminal-panel] .gharargah-terminal-surface, [data-gharargah-terminal-panel] .xterm",
        dropPath,
      )
      expect(ok).toBe(true)
      await expect
        .poll(async () => readTerminalText(page), { timeout: 10_000 })
        .toContain(needle)
    } finally {
      await app.close()
    }
  })

  test("drops a workspace file onto the editor and opens it", async () => {
    const { app, page } = await launchJet()
    try {
      await showTerminal(page)
      // Switch to editor pane so the editor surface is hit-testable.
      await page.locator('[data-gharargah-session-mode-tab="editor"]').click()
      await expectLocatorVisible(page.locator("[data-gharargah-modal-editor]").first())

      const filePath = await page.evaluate(() => {
        const root = window.__gharargahAgent!.getState().activeWorkspace
        if (!root) throw new Error("no workspace")
        return `${root}/src/index.ts`
      })

      const ok = await dispatchFileDrop(
        page,
        "[data-gharargah-modal-editor]",
        filePath,
        "ignored-when-path-present\n",
      )
      expect(ok).toBe(true)

      await page.evaluate(() => window.__gharargahAgent!.waitForEditor())
      await expect
        .poll(async () => page.evaluate(() => window.__gharargahAgent!.getState().sessionMode), {
          timeout: 10_000,
        })
        .toBe("editor")
      await expect
        .poll(async () => page.evaluate(() => window.__gharargahAgent!.getEditorText() ?? ""), {
          timeout: 10_000,
        })
        .toMatch(/greet|export|function|const/)
      const buffers = await page.evaluate(() => window.__gharargahAgent!.getState().openBuffers)
      expect(buffers.some(b => b.includes("index.ts"))).toBe(true)
    } finally {
      await app.close()
    }
  })

  test("blob-only drop on editor opens untitled buffer with contents", async () => {
    const { app, page } = await launchJet()
    try {
      await showTerminal(page)
      await page.locator('[data-gharargah-session-mode-tab="editor"]').click()
      await expectLocatorVisible(page.locator("[data-gharargah-modal-editor]").first())

      const ok = await page.evaluate(() => {
        const el = document.querySelector("[data-gharargah-modal-editor]")
        if (!el) return false
        const rect = el.getBoundingClientRect()
        const file = new File(["untitled-drop-marker-42\n"], "dropped-note.md", {
          type: "text/markdown",
        })
        const dt = new DataTransfer()
        dt.items.add(file)
        const opts: DragEventInit = {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          dataTransfer: dt,
        }
        el.dispatchEvent(new DragEvent("drop", opts))
        return true
      })
      expect(ok).toBe(true)

      await page.evaluate(() => window.__gharargahAgent!.waitForEditor())
      await expect
        .poll(async () => page.evaluate(() => window.__gharargahAgent!.getEditorText() ?? ""), {
          timeout: 10_000,
        })
        .toContain("untitled-drop-marker-42")
    } finally {
      await app.close()
    }
  })
})
