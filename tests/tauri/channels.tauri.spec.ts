import { test, expect } from "@playwright/test"
import { RUST_HOST_CHANNELS } from "@gharargah/host-client"
import fs from "node:fs"
import path from "node:path"

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
      "git:summary",
      "git:branches",
      "git:stage",
      "git:unstage",
      "git:discard",
      "git:commit",
      "git:checkout",
      "git:fetch",
      "git:pull",
      "git:push",
      "git:history",
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
      "perf:recordStartup",
      "perf:getStartupLogPath",
      "agents:listProviders",
      "agents:sendMessage",
      "gharargah:getLaunchConfig",
      "gharargah:getHomeDir",
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

  test("uses native window decorations without overlay titlebar", () => {
    const capability = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), "apps/gharargah/src-tauri/capabilities/default.json"),
        "utf8",
      ),
    ) as { permissions: string[] }
    const config = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), "apps/gharargah/src-tauri/tauri.conf.json"),
        "utf8",
      ),
    ) as {
      app: {
        windows: Array<{
          decorations?: boolean
          titleBarStyle?: string
          hiddenTitle?: boolean
          trafficLightPosition?: { x: number; y: number }
        }>
      }
    }

    expect(capability.permissions).toContain("core:window:allow-start-dragging")
    expect(config.app.windows[0]?.decorations).toBe(true)
    expect(config.app.windows[0]?.titleBarStyle ?? "Visible").not.toBe("Overlay")
    expect(config.app.windows[0]?.hiddenTitle).toBeFalsy()
    expect(config.app.windows[0]?.trafficLightPosition).toBeUndefined()
  })
})
