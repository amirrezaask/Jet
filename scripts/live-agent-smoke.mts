/**
 * Live provider smoke — hits Effect agent-server without MOCK.
 * Usage:
 *   YAADE_LIVE_SMOKE=1 pnpm exec tsx scripts/live-agent-smoke.mts
 */
import { spawn } from "node:child_process"
import { createServer } from "node:net"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createEffectAgentsClient } from "../packages/yaade-host-client/src/effect-agents-client.ts"

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const providers = [
  { agentId: "codex", driverId: "codex:app-server" },
  { agentId: "claude", driverId: "claude:sdk" },
  { agentId: "opencode", driverId: "opencode:sdk" },
  { agentId: "cursor", driverId: "cursor:acp" },
] as const

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const s = createServer()
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address()
      if (!addr || typeof addr === "string") {
        reject(new Error("no port"))
        return
      }
      const port = addr.port
      s.close(() => resolve(port))
    })
  })
}

async function waitHealth(port: number): Promise<void> {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`)
      if (res.ok) return
    } catch {
      /* retry */
    }
    await new Promise(r => setTimeout(r, 200))
  }
  throw new Error("agent-server health timeout")
}

async function main(): Promise<void> {
  const port = await freePort()
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "yaade-live-"))
  fs.writeFileSync(path.join(workspace, "README.md"), "# live smoke\n")
  const tsx = path.join(REPO, "node_modules/tsx/dist/cli.mjs")
  const child = spawn(process.execPath, [tsx, path.join(REPO, "apps/agent-server/src/bin.ts")], {
    cwd: REPO,
    env: {
      ...process.env,
      YAADE_AGENT_HOST: "127.0.0.1",
      YAADE_AGENT_PORT: String(port),
      // Explicitly off — this is the live path.
      YAADE_AGENT_MOCK: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let logs = ""
  child.stdout?.on("data", d => {
    logs += String(d)
  })
  child.stderr?.on("data", d => {
    logs += String(d)
  })

  try {
    await waitHealth(port)
    const client = createEffectAgentsClient({ url: `ws://127.0.0.1:${port}/agents` })
    await client.ready
    const rootUri = `file://${workspace}`
    const results: Array<Record<string, unknown>> = []

    for (const p of providers) {
      const started = Date.now()
      try {
        const thread = await client.createThread({
          workspaceRootUri: rootUri,
          workspaceRootPath: workspace,
          title: `live-${p.agentId}`,
          agentId: p.agentId,
          driverId: p.driverId,
        })
        await client.sendMessage({
          workspaceRootUri: rootUri,
          workspaceRootPath: workspace,
          threadId: thread.id,
          text: "Reply with exactly the word PONG and nothing else.",
          agentId: p.agentId,
          driverId: p.driverId,
        })
        const deadline = Date.now() + 60_000
        let final = thread
        while (Date.now() < deadline) {
          const th = await client.readThread(rootUri, workspace, thread.id)
          if (th && (th.status === "idle" || th.status === "error" || th.status === "interrupted")) {
            final = th
            break
          }
          await new Promise(r => setTimeout(r, 400))
        }
        const assistant = [...(final.messages ?? [])]
          .reverse()
          .find(m => m.role === "assistant")
        results.push({
          provider: p.agentId,
          status: final.status,
          error: final.lastError,
          text: (assistant?.text ?? "").slice(0, 200),
          ms: Date.now() - started,
        })
      } catch (err) {
        results.push({
          provider: p.agentId,
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
          text: "",
          ms: Date.now() - started,
        })
      }
    }

    console.log(JSON.stringify({ port, workspace, results }, null, 2))
    const bad = results.filter(
      r => r.status !== "idle" || !String(r.text ?? "").toLowerCase().includes("pong"),
    )
    client.close()
    if (bad.length) {
      console.error("LIVE_SMOKE_FAILURES", bad.map(b => b.provider))
      process.exitCode = 1
    } else {
      console.log("LIVE_SMOKE_OK")
    }
  } finally {
    child.kill("SIGTERM")
    setTimeout(() => child.kill("SIGKILL"), 2000)
    console.error("--- agent-server log tail ---\n" + logs.slice(-3000))
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
