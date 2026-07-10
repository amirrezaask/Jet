import { parentPort } from "node:worker_threads"
import {
  gitIsRepo,
  gitStatus,
  gitDiff,
  gitBranch,
  gitStage,
  gitUnstage,
  gitCommit,
  gitBranches,
  gitCheckout,
} from "@jet/node-host"

type Task = { id: number; type: string; payload: Record<string, unknown> }

parentPort?.on("message", async (task: Task) => {
  try {
    const rootUri = String(task.payload.rootUri ?? "")
    let result: unknown
    switch (task.type) {
      case "isRepo":
        result = await gitIsRepo(rootUri)
        break
      case "branch": {
        const repo = await gitIsRepo(rootUri)
        result = repo ? await gitBranch(rootUri) : null
        break
      }
      case "status":
        result = await gitStatus(rootUri)
        break
      case "diff":
        result = await gitDiff(rootUri, {
          path: task.payload.path ? String(task.payload.path) : undefined,
          staged: Boolean(task.payload.staged),
        })
        break
      case "stage":
        await gitStage(rootUri, (task.payload.paths as string[]) ?? [])
        result = undefined
        break
      case "unstage":
        await gitUnstage(rootUri, (task.payload.paths as string[]) ?? [])
        result = undefined
        break
      case "commit":
        await gitCommit(rootUri, String(task.payload.message ?? ""))
        result = undefined
        break
      case "branches":
        result = await gitBranches(rootUri)
        break
      case "checkout":
        await gitCheckout(rootUri, String(task.payload.branch ?? ""))
        result = undefined
        break
      default:
        throw new Error(`unknown git task: ${task.type}`)
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
