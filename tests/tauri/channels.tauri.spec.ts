import { test, expect } from "@playwright/test"
import { RUST_HOST_CHANNELS } from "@jet/host-client"

test.describe("tauri host channel registry", () => {
  test("rust allowlist includes core jet api channels", () => {
    const required = [
      "fs:readFile",
      "fs:writeFile",
      "fs:readDir",
      "fs:stat",
      "fs:showOpenFolderDialog",
      "fs:showSaveFileDialog",
      "git:isRepo",
      "git:status",
      "git:diff",
      "git:branch",
      "search:listFiles",
      "search:project",
      "search:fileSearch",
      "search:trackFileAccess",
      "search:isScanReady",
      "search:isSupported",
      "workspace:activate",
      "workspace:deactivate",
      "lsp:start",
      "lsp:stop",
      "terminal:create",
      "terminal:write",
      "terminal:resize",
      "terminal:attach",
      "terminal:dispose",
      "tasks:spawn",
      "agents:listProviders",
      "agents:sendMessage",
      "jet:getLaunchConfig",
      "jet:getHomeDir",
      "ui:syncNativeChrome",
    ]
    for (const channel of required) {
      expect(RUST_HOST_CHANNELS.has(channel), `missing ${channel}`).toBe(true)
    }
  })

  test("allowlist size stays within expected host surface", () => {
    expect(RUST_HOST_CHANNELS.size).toBeGreaterThanOrEqual(30)
    expect(RUST_HOST_CHANNELS.size).toBeLessThanOrEqual(60)
  })
})
