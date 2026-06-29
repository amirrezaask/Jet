import type { BraceScopeScanJob, BraceScopeScanResult } from "../brace-scope-scan.js"

type ResultHandler = (result: BraceScopeScanResult) => void

let worker: Worker | null = null
let nextRequestId = 0
const latestRequestIdByOwner = new Map<number, number>()
const pendingByOwner = new Map<number, ResultHandler>()
const ownerByRequestId = new Map<number, number>()

function ensureWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./brace-scope.worker.ts", import.meta.url), { type: "module" })
    worker.onmessage = (event: MessageEvent<BraceScopeScanResult>) => {
      const result = event.data
      const ownerId = ownerByRequestId.get(result.requestId)
      if (ownerId == null) return
      ownerByRequestId.delete(result.requestId)
      const latest = latestRequestIdByOwner.get(ownerId) ?? 0
      if (result.requestId < latest) return
      pendingByOwner.get(ownerId)?.(result)
      pendingByOwner.delete(ownerId)
    }
  }
  return worker
}

export class BraceScopeHost {
  private cancelledOwners = new Set<number>()

  schedule(
    ownerId: number,
    job: Omit<BraceScopeScanJob, "requestId" | "ownerId">,
    onResult: ResultHandler,
  ): void {
    this.cancelledOwners.delete(ownerId)
    const requestId = ++nextRequestId
    latestRequestIdByOwner.set(ownerId, requestId)
    pendingByOwner.set(ownerId, result => {
      if (this.cancelledOwners.has(ownerId) || result.requestId < (latestRequestIdByOwner.get(ownerId) ?? 0)) {
        return
      }
      onResult(result)
    })
    ownerByRequestId.set(requestId, ownerId)
    ensureWorker().postMessage({ ...job, requestId, ownerId })
  }

  cancel(ownerId: number): void {
    this.cancelledOwners.add(ownerId)
    pendingByOwner.delete(ownerId)
  }

  static terminate(): void {
    worker?.terminate()
    worker = null
    pendingByOwner.clear()
    latestRequestIdByOwner.clear()
    ownerByRequestId.clear()
  }
}

let sharedHost: BraceScopeHost | null = null

export function getBraceScopeHost(): BraceScopeHost {
  if (!sharedHost) sharedHost = new BraceScopeHost()
  return sharedHost
}
