import { appendFile, mkdir, rename, rm, stat } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import type { HostRegistry } from "./registry.js"

const MAX_STARTUP_LOG_BYTES = 5 * 1024 * 1024

function startupLogPath(): string {
  const base = process.env.JET_E2E_USER_DATA ?? path.join(homedir(), ".jet")
  return path.join(base, "perf", "startup.jsonl")
}

async function rotateIfNeeded(logPath: string): Promise<void> {
  const size = await stat(logPath).then(value => value.size).catch(() => 0)
  if (size < MAX_STARTUP_LOG_BYTES) return
  const rotated = logPath.replace(/\.jsonl$/, ".previous.jsonl")
  await rm(rotated, { force: true })
  await rename(logPath, rotated)
}

export function registerPerfHandlers(registry: HostRegistry): void {
  registry.handle("perf:getStartupLogPath", () => startupLogPath())
  registry.handle("perf:recordStartup", async args => {
    const logPath = startupLogPath()
    await mkdir(path.dirname(logPath), { recursive: true })
    await rotateIfNeeded(logPath)
    const payload = args[0]
    const record = {
      ...(payload && typeof payload === "object" ? payload : {}),
      hostProcessElapsedMs: process.uptime() * 1000,
      recordedAt: new Date().toISOString(),
    }
    await appendFile(logPath, `${JSON.stringify(record)}\n`, "utf8")
    return logPath
  })
}
