import { bootJetApi } from "./jet-adapter.js"

void (async () => {
  await bootJetApi()
  // Dynamic import keeps initial parse/eval off the critical path (Athas-style).
  await import("../../../packages/jet-app/src/main.tsx")
})()
