import { parentPort } from "node:worker_threads"
import { readFile, writeFile, readDir, stat } from "@jet/node-host"

type Task = { id: number; type: string; payload: Record<string, unknown> }

parentPort?.on("message", async (task: Task) => {
  try {
    let result: unknown
    switch (task.type) {
      case "readFile":
        result = await readFile(String(task.payload.uri ?? ""))
        break
      case "writeFile":
        await writeFile(String(task.payload.uri ?? ""), String(task.payload.content ?? ""))
        result = undefined
        break
      case "readDir":
        result = await readDir(String(task.payload.uri ?? ""))
        break
      case "stat":
        result = await stat(String(task.payload.uri ?? ""))
        break
      default:
        throw new Error(`unknown fs task: ${task.type}`)
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
