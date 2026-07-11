import { test, expect } from "@playwright/test"
import { RUST_HOST_CHANNELS } from "@jet/host-client"
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

  test("native titlebar grants drag permission and keeps centered traffic lights", () => {
    const capability = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), "apps/jet-tauri/src-tauri/capabilities/default.json"),
        "utf8",
      ),
    ) as { permissions: string[] }
    const config = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), "apps/jet-tauri/src-tauri/tauri.conf.json"),
        "utf8",
      ),
    ) as {
      app: {
        windows: Array<{
          titleBarStyle?: string
          trafficLightPosition?: { x: number; y: number }
        }>
      }
    }
    const shellRs = fs.readFileSync(
      path.join(process.cwd(), "apps/jet-tauri/src-tauri/src/shell.rs"),
      "utf8",
    )
    const electronMain = fs.readFileSync(
      path.join(process.cwd(), "apps/jet-desktop/src/main/main.ts"),
      "utf8",
    )

    expect(capability.permissions).toContain("core:window:allow-start-dragging")
    expect(config.app.windows[0]?.titleBarStyle).toBe("Overlay")
    expect(config.app.windows[0]?.trafficLightPosition).toEqual({ x: 14, y: 11 })
    // Config alone is not enough on modern macOS — shell must force button origin.y
    // to match Electron trafficLightPosition (see apply_traffic_light_position).
    expect(shellRs).toMatch(/TRAFFIC_LIGHT_X:\s*f64\s*=\s*14\.0/)
    expect(shellRs).toMatch(/TRAFFIC_LIGHT_Y:\s*f64\s*=\s*11\.0/)
    expect(shellRs).toContain("apply_traffic_light_position")
    expect(shellRs).toContain("rect.origin.y = 0.0")
    expect(electronMain).toContain("trafficLightPosition: { x: 14, y: 11 }")
  })
})
