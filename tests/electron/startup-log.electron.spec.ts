import { expect, test } from "@playwright/test"
import fs from "node:fs"
import { launchJet } from "./_launch.js"

test.describe("desktop startup telemetry", () => {
  test("persists a startup record for the active shell and build mode", async () => {
    const { app, page } = await launchJet()
    try {
      const logPath = await page.evaluate(async () => window.gharargah?.getStartupLogPath?.())
      expect(logPath).toBeTruthy()
      await expect
        .poll(async () => {
          if (!logPath || !fs.existsSync(logPath)) return null
          const line = fs.readFileSync(logPath, "utf8").trim().split("\n").at(-1)
          return line ? JSON.parse(line) : null
        }, { timeout: 10_000 })
        .not.toBeNull()

      const latest = JSON.parse(
        fs.readFileSync(logPath!, "utf8").trim().split("\n").at(-1)!,
      ) as Record<string, unknown>
      expect(latest.shell).toBe("tauri")
      expect(latest.buildMode).toMatch(/debug|release/)
      expect(latest.rendererReadyMs).toEqual(expect.any(Number))
      expect(latest.hostProcessElapsedMs).toEqual(expect.any(Number))
      expect(latest.workspaceRootCount).toBeGreaterThanOrEqual(1)
    } finally {
      await app.close()
    }
  })
})
