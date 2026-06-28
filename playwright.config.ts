import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./tests/smoke",
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
})
