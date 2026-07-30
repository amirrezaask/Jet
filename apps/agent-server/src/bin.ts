import { Effect } from "effect"
import { startAgentServerEffect } from "./rpc/server.js"
import { prepareShellEnv } from "./shell-env.js"

prepareShellEnv()

const host = process.env.GHARARGAH_AGENT_HOST ?? "127.0.0.1"
const port = Number(process.env.GHARARGAH_AGENT_PORT ?? 4751)

const program = Effect.gen(function* () {
  const server = yield* startAgentServerEffect({ host, port })
  yield* Effect.sync(() => {
    console.log(`[gharargah-agent-server] listening on http://${server.host}:${server.port}`)
    console.log(`[gharargah-agent-server] ws://${server.host}:${server.port}/agents`)
    console.log(
      `[gharargah-agent-server] mock=${process.env.GHARARGAH_AGENT_MOCK === "1" ? "1" : "0"} e2e=${process.env.GHARARGAH_E2E ?? "0"}`,
    )
    console.log(
      `[gharargah-agent-server] shellEnv=${process.env.PATH?.split(":").slice(0, 3).join(":")}…`,
    )
  })

  yield* Effect.async<never>(resume => {
    const stop = () => {
      void server.close().then(() => resume(Effect.void as never))
    }
    process.on("SIGINT", stop)
    process.on("SIGTERM", stop)
  })
})

await Effect.runPromise(program)
