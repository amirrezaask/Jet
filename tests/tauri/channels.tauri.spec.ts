import { test, expect } from "@playwright/test"
import { RUST_HOST_CHANNELS } from "@jet/host-client"

test.describe("tauri host channel registry", () => {
  test("rust allowlist includes core jet api channels", () => {
    const required = [
      "fs:readFile",
      "fs:writeFile",
      "fs:showOpenFolderDialog",
      "workspace:activate",
      "search:project",
      "lsp:start",
      "terminal:create",
      "agents:sendMessage",
      "jet:getLaunchConfig",
      "ui:syncNativeChrome",
    ]
    for (const channel of required) {
      expect(RUST_HOST_CHANNELS.has(channel), `missing ${channel}`).toBe(true)
    }
  })
})
