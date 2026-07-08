import { defineConfig } from "@playwright/test"

export default defineConfig({
  timeout: 60_000,
  retries: 1,
  workers: 1,
  fullyParallel: false,
  projects: [
    {
      name: "electron",
      testDir: "./tests/electron",
      testMatch: "*.electron.spec.ts",
    },
  ],
})
