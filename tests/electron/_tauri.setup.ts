import { test } from "@playwright/test"

// Force tauri shell for all specs in this project (see playwright.config.ts tauri-e2e).
process.env.GHARARGAH_SHELL = "tauri"

test.beforeAll(() => {
  process.env.GHARARGAH_SHELL = "tauri"
})
