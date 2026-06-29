import type { BraceScopeScanJob, BraceScopeScanResult } from "../brace-scope-scan.js"

type ResultHandler = (result: BraceScopeScanResult) => void

let worker: Worker | null = null
let nextRequestId = 0
let latestRequestId = 0
let pendingHandler: ResultHandler | null = null

function ensureWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./brace-scope.worker.ts", import.meta.url), { type: "module" })
    worker.onmessage = (event: MessageEvent<BraceScopeScanResult>) => {
      const result = event.data
      if (result.requestId < latestRequestId) return
      pendingHandler?.(result)
      pendingHandler = null
    }
  }
  return worker
}

export class BraceScopeHost {
  private cancelled = false

  schedule(job: Omit<BraceScopeScanJob, "requestId">, onResult: ResultHandler): void {
    this.cancelled = false
    const requestId = ++nextRequestId
    latestRequestId = requestId
    pendingHandler = result => {
      if (this.cancelled || result.requestId < latestRequestId) return
      onResult(result)
    }
    ensureWorker().postMessage({ ...job, requestId })
  }

  cancel(): void {
    this.cancelled = true
    pendingHandler = null
  }

  static terminate(): void {
    worker?.terminate()
    worker = null
    pendingHandler = null
  }
}

let sharedHost: BraceScopeHost | null = null

export function getBraceScopeHost(): BraceScopeHost {
  if (!sharedHost) sharedHost = new BraceScopeHost()
  return sharedHost
}
