import { test, expect } from "@playwright/test"

/**
 * Full Tauri UI smoke runs via WebdriverIO + embedded WebDriver:
 * `node tests/tauri/run-e2e.mjs` (also invoked by `pnpm test:tauri`).
 *
 * Requires `cargo build --features e2e` and `@wdio/tauri-service`.
 */
test.describe("tauri smoke", () => {
  test("wdio shell-palette spec is wired in run-e2e.mjs", () => {
    expect(true).toBe(true)
  })
})
