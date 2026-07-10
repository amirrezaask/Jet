import { bootJetApi } from "./jet-adapter.js"

void (async () => {
  await bootJetApi()
  await import("../../../packages/jet-app/src/main.tsx")
})()
