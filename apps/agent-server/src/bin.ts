import { startAgentServer } from "./rpc/server.js"
import { prepareShellEnv } from "./shell-env.js"

prepareShellEnv()

const host = process.env.GHARARGAH_AGENT_HOST ?? "127.0.0.1"
const port = Number(process.env.GHARARGAH_AGENT_PORT ?? 4751)

const server = await startAgentServer({ host, port })
console.log(`[gharargah-agent-server] listening on http://${server.host}:${server.port}`)
console.log(`[gharargah-agent-server] ws://${server.host}:${server.port}/agents`)
console.log(
  `[gharargah-agent-server] mock=${process.env.GHARARGAH_AGENT_MOCK === "1" ? "1" : "0"} e2e=${process.env.GHARARGAH_E2E ?? "0"}`,
)
console.log(`[gharargah-agent-server] shellEnv=${process.env.PATH?.split(":").slice(0, 3).join(":")}…`)

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void server.close().then(() => process.exit(0))
  })
}
