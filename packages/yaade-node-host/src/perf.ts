import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const MAX_LOG_BYTES = 5 * 1024 * 1024

export class PerfHost {
  private readonly logPath: string
  private readonly processStarted: number

  constructor(homeDir: string, processStarted = Date.now()) {
    const base =
      process.env.YAADE_E2E_USER_DATA?.trim() ||
      path.join(homeDir || os.homedir(), ".yaade")
    this.logPath = path.join(base, "perf", "startup.jsonl")
    this.processStarted = processStarted
  }

  getStartupLogPath(): string {
    return this.logPath
  }

  recordStartup(payload: Record<string, unknown>): string {
    fs.mkdirSync(path.dirname(this.logPath), { recursive: true })
    try {
      const stat = fs.statSync(this.logPath)
      if (stat.size > MAX_LOG_BYTES) fs.unlinkSync(this.logPath)
    } catch {
      /* missing ok */
    }
    const record = {
      ...payload,
      hostProcessElapsedMs: Date.now() - this.processStarted,
      recordedAt: new Date().toISOString(),
      buildMode: process.env.NODE_ENV === "production" ? "production" : "development",
      ...(process.env.YAADE_STARTUP_RUN_ID
        ? { runId: process.env.YAADE_STARTUP_RUN_ID }
        : {}),
      ...(process.env.YAADE_STARTUP_RUN_KIND
        ? { runKind: process.env.YAADE_STARTUP_RUN_KIND }
        : {}),
      ...(process.env.YAADE_BUILD_COMMIT
        ? { buildCommit: process.env.YAADE_BUILD_COMMIT }
        : {}),
      ...(process.env.YAADE_STARTUP_SAMPLE
        ? { sample: process.env.YAADE_STARTUP_SAMPLE }
        : {}),
    }
    fs.appendFileSync(this.logPath, `${JSON.stringify(record)}\n`, "utf8")
    return this.logPath
  }
}
