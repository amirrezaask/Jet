import assert from "node:assert/strict"
import { test } from "node:test"
import { AcpClientPool } from "./acp-pool.js"
import { ACP_IDLE_REAP_MS } from "@gharargah/effect-acp"

test("AcpClientPool reaps idle clients", async () => {
  const pool = new AcpClientPool()
  const fake = {
    close: async () => undefined,
  }
  pool.set("k1", fake as never)
  assert.equal(pool.size(), 1)
  const reaped = await pool.reapIdle(Date.now() + ACP_IDLE_REAP_MS + 1)
  assert.deepEqual(reaped, ["k1"])
  assert.equal(pool.size(), 0)
  pool.stopReaper()
})
