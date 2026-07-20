import { bootGharargahApi } from "./gharargah-adapter.js"

;(window as Window & { __gharargahStartupBootstrapAt?: number }).__gharargahStartupBootstrapAt = performance.now()

void (async () => {
  await bootGharargahApi()
  // Dynamic import keeps initial parse/eval off the critical path (Athas-style).
  await import("../../../packages/gharargah-app/src/main.tsx")
})()
