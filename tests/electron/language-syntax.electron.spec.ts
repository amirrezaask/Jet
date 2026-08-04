import { expect, test } from "@playwright/test"
import {
  expectLocatorVisible,
  expectSelectorVisible,
} from "../shell/assert.js"
import { execCommand, hasPtySpawn, launchJet } from "./_launch.js"

const ptyAvailable = hasPtySpawn()

const CASES: { path: string; languageId: string }[] = [
  { path: "src/example.py", languageId: "python" },
  { path: "src/example.rb", languageId: "ruby" },
  { path: "src/example.go", languageId: "go" },
  { path: "src/example.rs", languageId: "rust" },
]

const LSP_STATUSES = new Set([
  "idle",
  "starting",
  "ready",
  "unavailable",
  "disconnected",
  "restarting",
  "failed",
])

test.describe.skip("editor language syntax ids", () => {
  test.skip(!ptyAvailable, "PTY support is required to open a session workspace")

  test("opens Go/Python/Ruby/Rust fixtures with correct language ids", async () => {
    const { app, page } = await launchJet()
    try {
      await execCommand(page, "terminal.new")
      await expectSelectorVisible(page, "[data-yaade-terminal-modal]", { timeout: 20_000 })

      for (const { path: rel, languageId } of CASES) {
        await page.evaluate(async file => {
          await window.__yaadeAgent!.openFile(file)
          await window.__yaadeAgent!.waitForEditor()
        }, rel)

        await expect
          .poll(() => page.evaluate(() => window.__yaadeAgent!.getState().sessionMode), {
            timeout: 15_000,
          })
          .toBe("editor")
        await expectLocatorVisible(page.locator("[data-yaade-monaco-editor]").first(), {
          timeout: 20_000,
        })
        await expect
          .poll(
            () =>
              page
                .locator("[data-yaade-editor-language]")
                .first()
                .getAttribute("data-yaade-editor-language"),
            { timeout: 15_000 },
          )
          .toBe(languageId)

        await expectSelectorVisible(page, "[data-yaade-terminal-modal]")
        const lsp = await page
          .locator("[data-yaade-editor-lsp]")
          .first()
          .getAttribute("data-yaade-editor-lsp")
        expect(LSP_STATUSES.has(lsp ?? "")).toBe(true)
      }
    } finally {
      await app.close()
    }
  })
})
