import os from "node:os"
import { defineConfig } from "@playwright/test"

const defaultWorkers = Math.max(1, Math.floor((os.cpus().length || 4) / 2))

export default defineConfig({
  timeout: 120_000,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.PLAYWRIGHT_WORKERS ? Number(process.env.PLAYWRIGHT_WORKERS) : defaultWorkers,
  fullyParallel: true,
  globalSetup: "./tests/web/global-setup.ts",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: "web-e2e",
      testDir: "./tests/electron",
      testMatch: "*.electron.spec.ts",
      timeout: 180_000,
    },
    {
      name: "bench",
      testDir: "./tests/bench",
      testMatch: "*.bench.ts",
      timeout: 180_000,
    },
  ],
})
