import { scanBraceScopes, type BraceScopeScanJob, type BraceScopeScanResult } from "../brace-scope-scan.js"

self.onmessage = (event: MessageEvent<BraceScopeScanJob>) => {
  const result: BraceScopeScanResult = scanBraceScopes(event.data)
  self.postMessage(result)
}
