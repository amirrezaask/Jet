import {
  startLspSession,
  stopLspSession,
  stopAllLspSessions,
  setLspCrashHandler,
} from "@jet/node-host"
import { sendToRenderer } from "./host-renderer.js"
import type { HostRegistry } from "./registry.js"

export {
  startLspSession,
  stopLspSession,
  stopAllLspSessions,
  setLspCrashHandler,
} from "@jet/node-host"

export function registerLspHandlers(registry: HostRegistry): void {
  setLspCrashHandler(id => sendToRenderer("lsp:crashed", id))

  registry.handle("lsp:start", async args =>
    new Promise((resolve, reject) => {
      setImmediate(() => {
        void startLspSession({
          rootUri: args[0] as string,
          command: args[2] as string | undefined,
          args: args[3] as string[] | undefined,
          onSpawnError: id => sendToRenderer("lsp:crashed", id),
        })
          .then(resolve)
          .catch(reject)
      })
    }),
  )

  registry.handle("lsp:stop", async args =>
    new Promise<void>((resolve, reject) => {
      setImmediate(() => {
        void stopLspSession(args[0] as string).then(resolve).catch(reject)
      })
    }),
  )
}

export function stopAllLsp(): void {
  stopAllLspSessions()
}
