import { Worker } from "node:worker_threads"
import path from "node:path"
import { fileURLToPath } from "node:url"

const moduleDir = path.dirname(fileURLToPath(import.meta.url))

type WorkerReply = { id: number; ok: boolean; result?: unknown; error?: string }

type Pending = {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
}

export class BackgroundWorker {
  private worker: Worker
  private seq = 0
  private pending = new Map<number, Pending>()

  constructor(workerFile: string) {
    this.worker = new Worker(workerFile)
    this.worker.on("message", (msg: WorkerReply) => {
      const p = this.pending.get(msg.id)
      if (!p) return
      this.pending.delete(msg.id)
      if (msg.ok) p.resolve(msg.result)
      else p.reject(new Error(msg.error ?? "background worker failed"))
    })
    this.worker.on("error", err => {
      for (const p of this.pending.values()) p.reject(err)
      this.pending.clear()
    })
  }

  dispatch<T>(type: string, payload: unknown): Promise<T> {
    const id = ++this.seq
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      })
      this.worker.postMessage({ id, type, payload })
    })
  }

  terminate(): void {
    for (const p of this.pending.values()) p.reject(new Error("background worker stopped"))
    this.pending.clear()
    void this.worker.terminate()
  }
}

function workerFile(name: string): string {
  return path.join(moduleDir, "workers", `${name}.js`)
}

let fsWorker: BackgroundWorker | null = null
let gitWorker: BackgroundWorker | null = null
let searchWorker: BackgroundWorker | null = null

function lazyWorker(current: BackgroundWorker | null, name: string): BackgroundWorker {
  if (current) return current
  return new BackgroundWorker(workerFile(name))
}

export function getFsWorker(): BackgroundWorker {
  fsWorker = lazyWorker(fsWorker, "fs-io")
  return fsWorker
}

export function getGitWorker(): BackgroundWorker {
  gitWorker = lazyWorker(gitWorker, "git-ops")
  return gitWorker
}

export function getSearchWorker(): BackgroundWorker {
  searchWorker = lazyWorker(searchWorker, "search-ops")
  return searchWorker
}

export function stopAllBackgroundWorkers(): void {
  fsWorker?.terminate()
  gitWorker?.terminate()
  searchWorker?.terminate()
  fsWorker = null
  gitWorker = null
  searchWorker = null
}

/** Spawn worker threads early so first IPC does not block the main event loop. */
export function prewarmBackgroundWorkers(): void {
  setImmediate(() => {
    getFsWorker()
    getGitWorker()
    getSearchWorker()
  })
}
