import { defineConfig } from "@playwright/test"

export default defineConfig({
  timeout: 120_000,
  retries: 1,
  workers: 1,
  fullyParallel: false,
  projects: [
    {
      name: "electron",
      testDir: "./tests/electron",
      testMatch: "*.electron.spec.ts",
    },
    {
      name: "bench",
      testDir: "./tests/bench",
      testMatch: "*.bench.ts",
      retries: 0,
      timeout: 180_000,
    },
  ],
})
