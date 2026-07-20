import { test, expect } from "@playwright/test"
import fs from "node:fs"
import path from "node:path"

test.describe("tauri smoke wiring", () => {
  test("shared shell suite uses the embedded E2E binary", () => {
    const launch = fs.readFileSync(path.join(process.cwd(), "tests/shell/launch-tauri.ts"), "utf8")
    for (const needle of [
      '"--features"',
      '"e2e"',
      "sample-workspace",
      "GHARARGAH_E2E_USER_DATA",
      "TAURI_WEBDRIVER_PORT",
      "wrapTauriWebDriver",
    ]) {
      expect(launch, `missing ${needle}`).toContain(needle)
    }
  })

  test("production capability excludes WebDriver", () => {
    const production = fs.readFileSync(
      path.join(process.cwd(), "apps/gharargah/src-tauri/capabilities/default.json"),
      "utf8",
    )
    const e2e = fs.readFileSync(
      path.join(process.cwd(), "apps/gharargah/src-tauri/tauri.e2e.conf.json"),
      "utf8",
    )
    expect(production).not.toContain("wdio-webdriver")
    expect(e2e).toContain("wdio-webdriver:default")
  })
})
