import { defineConfig } from "@playwright/test"
import os from "node:os"

const cpuCount = os.cpus().length
const defaultWorkers = process.env.CI
  ? Math.min(4, Math.max(2, Math.floor(cpuCount / 2)))
  : Math.max(2, Math.floor(cpuCount / 2))

export default defineConfig({
  timeout: 120_000,
  retries: 1,
  workers: process.env.PLAYWRIGHT_WORKERS ? Number(process.env.PLAYWRIGHT_WORKERS) : defaultWorkers,
  fullyParallel: true,
  globalSetup: "./tests/tauri/global-setup.ts",
  globalTeardown: "./tests/tauri/global-teardown.ts",
  projects: [
    {
      name: "tauri",
      testDir: "./tests/tauri",
      testMatch: "*.tauri.spec.ts",
    },
    {
      name: "tauri-e2e",
      testDir: "./tests/electron",
      testMatch: "*.electron.spec.ts",
      grepInvert: /agents|agent launch|Launch agent|workspace-open-via-agent/,
      workers: 1,
      retries: 0,
      timeout: 180_000,
    },
    {
      name: "bench",
      testDir: "./tests/bench",
      testMatch: "*.bench.ts",
      retries: 0,
      timeout: 180_000,
      fullyParallel: false,
      workers: 1,
    },
  ],
})
