import { defineConfig } from "@playwright/test"

export default defineConfig({
  timeout: 60_000,
  retries: 1,
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: "http://localhost:5174",
    headless: true,
    trace: "on-first-retry",
  },
  webServer: {
    command: "pnpm dev:web",
    url: "http://localhost:5174",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    {
      name: "web",
      testDir: "./tests/specs",
      testIgnore: "**/*.screenshot.spec.ts",
    },
    {
      name: "screenshots",
      testDir: "./tests/specs",
      testMatch: "**/*.screenshot.spec.ts",
      snapshotPathTemplate: "{testDir}/golden/{testFilePath}/{arg}{ext}",
    },
    {
      name: "electron",
      testDir: "./tests/electron",
      testMatch: "*.electron.spec.ts",
    },
  ],
})
