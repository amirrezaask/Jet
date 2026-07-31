import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  agentDriverIdForMode,
  agentSupportsNativeDriver,
  defaultAgentDriverMode,
  readAgentDriverMode,
  readAgentDriverModes,
  writeAgentDriverMode,
} from "./driver-mode.js"

function memoryStorage() {
  const map = new Map<string, string>()
  return {
    getItem(key: string) {
      return map.get(key) ?? null
    },
    setItem(key: string, value: string) {
      map.set(key, value)
    },
  }
}

describe("agent driver mode", () => {
  it("defaults to cli for all agents", () => {
    assert.equal(defaultAgentDriverMode("codex"), "cli")
    assert.equal(readAgentDriverMode("codex", memoryStorage()), "cli")
    assert.deepEqual(readAgentDriverModes(memoryStorage()), {})
  })

  it("round-trips write/read per agent", () => {
    const storage = memoryStorage()
    const afterCodex = writeAgentDriverMode("codex", "native", storage)
    assert.equal(afterCodex.codex, "native")
    assert.equal(readAgentDriverMode("codex", storage), "native")
    const afterClaude = writeAgentDriverMode("claude", "cli", storage)
    assert.equal(afterClaude.claude, "cli")
    assert.equal(readAgentDriverMode("claude", storage), "cli")
    assert.equal(readAgentDriverMode("codex", storage), "native")
  })

  it("recovers from corrupt JSON", () => {
    const storage = memoryStorage()
    storage.setItem("gharargah-agent-driver-mode", "{not json")
    assert.deepEqual(readAgentDriverModes(storage), {})
    assert.equal(readAgentDriverMode("codex", storage), "cli")
  })

  it("recovers from throwing storage", () => {
    const storage = {
      getItem() {
        throw new Error("blocked")
      },
      setItem() {
        throw new Error("blocked")
      },
    }
    assert.deepEqual(readAgentDriverModes(storage), {})
    assert.deepEqual(writeAgentDriverMode("codex", "native", storage), {
      codex: "native",
    })
  })

  it("recovers from non-object JSON", () => {
    const storage = memoryStorage()
    storage.setItem("gharargah-agent-driver-mode", JSON.stringify(["cli"]))
    assert.deepEqual(readAgentDriverModes(storage), {})
  })

  it("coerces invalid mode values to cli", () => {
    const storage = memoryStorage()
    storage.setItem(
      "gharargah-agent-driver-mode",
      JSON.stringify({ codex: "bogus" }),
    )
    assert.equal(readAgentDriverMode("codex", storage), "cli")
  })

  it("coerces unsupported agents to cli and ignores them in storage", () => {
    const storage = memoryStorage()
    const next = writeAgentDriverMode("unknown-agent", "native", storage)
    assert.equal(next["unknown-agent"], "cli")
    storage.setItem(
      "gharargah-agent-driver-mode",
      JSON.stringify({ "unknown-agent": "native", codex: "native" }),
    )
    const modes = readAgentDriverModes(storage)
    assert.equal(modes.codex, "native")
    assert.equal(modes["unknown-agent"], undefined)
    assert.equal(agentSupportsNativeDriver("unknown-agent"), false)
  })

  it("agentDriverIdForMode maps all five agents in both modes", () => {
    const agents = ["codex", "claude", "cursor", "opencode", "grok"] as const
    for (const agentId of agents) {
      assert.equal(agentDriverIdForMode(agentId, "cli"), `${agentId}:cli`)
      assert.match(agentDriverIdForMode(agentId, "native"), /:/)
      assert.notEqual(
        agentDriverIdForMode(agentId, "native"),
        `${agentId}:cli`,
      )
    }
    assert.equal(agentDriverIdForMode("codex", "native"), "codex:app-server")
    assert.equal(agentDriverIdForMode("claude", "native"), "claude:sdk")
    assert.equal(agentDriverIdForMode("cursor", "native"), "cursor:acp")
    assert.equal(agentDriverIdForMode("opencode", "native"), "opencode:sdk")
    assert.equal(agentDriverIdForMode("grok", "native"), "grok:acp")
  })
})
