import { defineConfig } from "@playwright/test"

export default defineConfig({
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:5174",
    trace: "on-first-retry",
  },
  webServer: {
    command: "pnpm dev:web",
    url: "http://localhost:5174",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    { name: "smoke", testDir: "./tests/smoke" },
    { name: "visual", testDir: "./tests/visual", testMatch: "visual.spec.ts" },
    {
      name: "visual-screenshots",
      testDir: "./tests/visual",
      testMatch: "explorer-screenshot.spec.ts",
      snapshotPathTemplate: "{testDir}/golden/{testFilePath}/{arg}{ext}",
    },
    {
      name: "electron",
      testDir: "./tests/electron",
      testMatch: "*.electron.spec.ts",
    },
  ],
})
