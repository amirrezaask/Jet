import assert from "node:assert/strict"
import { test } from "node:test"
import { startAgentServer } from "./server.js"

test("health endpoint + listAgents rpc", async () => {
  const server = await startAgentServer({ host: "127.0.0.1", port: 0 })
  // port 0 may not work with our listen - use ephemeral by reading address
  // Our API takes fixed port; pick a high port
  await server.close()

  const port = 18765 + Math.floor(Math.random() * 1000)
  const live = await startAgentServer({ host: "127.0.0.1", port })
  const res = await fetch(`http://127.0.0.1:${port}/health`)
  assert.equal(res.status, 200)
  const body = (await res.json()) as { ok: boolean }
  assert.equal(body.ok, true)

  const wsUrl = `ws://127.0.0.1:${port}/agents`
  const result = await new Promise<unknown>((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const timer = setTimeout(() => reject(new Error("timeout")), 5_000)
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ id: 1, method: "agents:listAgents", params: [] }))
    })
    ws.addEventListener("message", ev => {
      const msg = JSON.parse(String(ev.data)) as { id?: number; result?: unknown; error?: string }
      if (msg.id === 1) {
        clearTimeout(timer)
        ws.close()
        if (msg.error) reject(new Error(msg.error))
        else resolve(msg.result)
      }
    })
    ws.addEventListener("error", () => reject(new Error("ws error")))
  })
  const catalog = result as { agents: unknown[] }
  assert.ok(Array.isArray(catalog.agents))
  assert.ok(catalog.agents.length >= 1)
  await live.close()
})
