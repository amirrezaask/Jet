import { test, expect } from "@playwright/test"
import fs from "node:fs"
import path from "node:path"

/**
 * Full Tauri UI smoke runs via node:http WebDriver:
 * `node tests/tauri/run-e2e.mjs` (also invoked by `pnpm test:tauri`).
 */
test.describe("tauri smoke wiring", () => {
  test("ui suite covers shell, terminal, quick-open, editor, titlebar", () => {
    const suite = fs.readFileSync(
      path.join(process.cwd(), "tests/tauri/run-ui-suite.mjs"),
      "utf8",
    )
    for (const needle of [
      "testShellPalette",
      "testTerminal",
      "testQuickOpen",
      "testEditorOpen",
      "testTitlebar",
    ]) {
      expect(suite, `missing ${needle}`).toContain(needle)
    }
  })

  test("run-e2e builds with e2e feature and sample workspace", () => {
    const runner = fs.readFileSync(path.join(process.cwd(), "tests/tauri/run-e2e.mjs"), "utf8")
    expect(runner).toContain("--features")
    expect(runner).toContain("e2e")
    expect(runner).toContain("sample-workspace")
    expect(runner).toContain("runUiSuite")
  })
})
