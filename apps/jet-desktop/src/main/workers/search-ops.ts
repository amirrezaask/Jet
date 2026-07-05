import { parentPort } from "node:worker_threads"
import {
  fileSearch,
  listProjectFiles,
  projectSearch,
  trackFileAccess,
} from "@jet/node-host"

type Task = { id: number; type: string; payload: Record<string, unknown> }

parentPort?.on("message", async (task: Task) => {
  try {
    const rootUri = String(task.payload.rootUri ?? "")
    let result: unknown
    switch (task.type) {
      case "listFiles":
        result = await listProjectFiles(rootUri)
        break
      case "fileSearch":
        result = await fileSearch(rootUri, String(task.payload.query ?? ""), {
          pageSize: task.payload.pageSize != null ? Number(task.payload.pageSize) : undefined,
          currentFile: task.payload.currentFile ? String(task.payload.currentFile) : undefined,
        })
        break
      case "project":
        result = await projectSearch(rootUri, String(task.payload.query ?? ""), {
          caseSensitive: Boolean(task.payload.caseSensitive),
          regex: Boolean(task.payload.regex),
          fuzzy: Boolean(task.payload.fuzzy),
        })
        break
      case "trackFileAccess":
        await trackFileAccess(
          rootUri,
          String(task.payload.query ?? ""),
          String(task.payload.path ?? ""),
        )
        result = { ok: true }
        break
      default:
        throw new Error(`unknown search task: ${task.type}`)
    }
    parentPort?.postMessage({ id: task.id, ok: true, result })
  } catch (err) {
    parentPort?.postMessage({
      id: task.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
})
