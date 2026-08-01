import fs from "node:fs"
import path from "node:path"
import os from "node:os"

export function hookQueueDir(dataDir?: string): string {
  const root =
    dataDir ??
    process.env.JET_DATA_DIR ??
    path.join(os.homedir(), ".local", "share", "jet")
  return path.join(root, "hook-queue")
}

/** Persist a failed hook delivery for later drain. */
export function enqueueFailedHook(
  payload: unknown,
  meta: { provider: string; sessionId: string; ingestUrl: string },
  dataDir?: string,
): string {
  const dir = hookQueueDir(dataDir)
  fs.mkdirSync(dir, { recursive: true })
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const file = path.join(dir, `${id}.json`)
  fs.writeFileSync(
    file,
    JSON.stringify({
      id,
      enqueuedAt: new Date().toISOString(),
      meta,
      payload,
    }),
    "utf8",
  )
  return file
}

export type QueuedHook = {
  file: string
  payload: unknown
  meta: { provider: string; sessionId: string; ingestUrl: string }
}

/** List queued hook files (oldest first). */
export function listQueuedHooks(dataDir?: string): QueuedHook[] {
  const dir = hookQueueDir(dataDir)
  if (!fs.existsSync(dir)) return []
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
  const out: QueuedHook[] = []
  for (const name of files) {
    const file = path.join(dir, name)
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
        payload: unknown
        meta: QueuedHook["meta"]
      }
      out.push({ file, payload: raw.payload, meta: raw.meta })
    } catch {
      /* skip corrupt */
    }
  }
  return out
}

export function removeQueuedHook(file: string): void {
  try {
    fs.unlinkSync(file)
  } catch {
    /* ignore */
  }
}
