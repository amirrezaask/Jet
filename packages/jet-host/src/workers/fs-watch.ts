import { parentPort, workerData } from "node:worker_threads"
import fs from "node:fs"
import path from "node:path"
import { pathToFileUri } from "@jet/shared"

type WorkerIn = { rootPath: string; requestId: number }

const WATCH_IGNORE_SEGMENTS = new Set([
  "node_modules",
  ".git",
  "dist",
  "dist-electron",
  ".turbo",
  ".pnpm-store",
])

const { rootPath, requestId } = workerData as WorkerIn
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

function shouldIgnore(filename: string): boolean {
  const parts = filename.split(/[/\\]/)
  return parts.some(part => WATCH_IGNORE_SEGMENTS.has(part))
}

const watcher = fs.watch(rootPath, { recursive: true }, (_event, filename) => {
  if (!filename) return
  const name = filename.toString()
  if (shouldIgnore(name)) return
  const filePath = path.join(rootPath, name)
  const uri = pathToFileUri(filePath)
  const existing = debounceTimers.get(uri)
  if (existing) clearTimeout(existing)
  debounceTimers.set(
    uri,
    setTimeout(() => {
      debounceTimers.delete(uri)
      parentPort?.postMessage({ requestId, type: "change" as const, uri })
    }, 300),
  )
})

parentPort?.postMessage({ requestId, type: "ready" as const })

watcher.on("error", err => {
  parentPort?.postMessage({
    requestId,
    type: "error" as const,
    error: err instanceof Error ? err.message : String(err),
  })
})
