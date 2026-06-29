import { parentPort } from "node:worker_threads"
import { listProjectFiles, projectSearch } from "@jet/node-host"

type Task = { id: number; type: string; payload: Record<string, unknown> }

parentPort?.on("message", async (task: Task) => {
  try {
    const rootUri = String(task.payload.rootUri ?? "")
    let result: unknown
    switch (task.type) {
      case "listFiles":
        result = await listProjectFiles(rootUri)
        break
      case "project":
        result = await projectSearch(rootUri, String(task.payload.query ?? ""), {
          caseSensitive: Boolean(task.payload.caseSensitive),
          regex: Boolean(task.payload.regex),
        })
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
