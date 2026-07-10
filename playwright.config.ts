import os from "node:os"
import { defineConfig } from "@playwright/test"

const cpuCount = os.cpus().length
const defaultWorkers = process.env.CI
  ? Math.min(4, Math.max(2, Math.floor(cpuCount / 2)))
  : Math.max(2, Math.floor(cpuCount / 2))

export default defineConfig({
  timeout: 120_000,
  retries: 1,
  workers: process.env.PLAYWRIGHT_WORKERS ? Number(process.env.PLAYWRIGHT_WORKERS) : defaultWorkers,
  fullyParallel: true,
  projects: [
    {
      name: "electron",
      testDir: "./tests/electron",
      testMatch: "*.electron.spec.ts",
    },
    {
      name: "tauri",
      testDir: "./tests/tauri",
      testMatch: "*.tauri.spec.ts",
    },
    {
      name: "bench",
      testDir: "./tests/bench",
      testMatch: "*.bench.ts",
      retries: 0,
      timeout: 180_000,
      fullyParallel: false,
    },
  ],
})
