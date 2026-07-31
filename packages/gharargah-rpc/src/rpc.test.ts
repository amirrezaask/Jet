import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { Effect, Schema } from "effect"
import {
  HostRpcRequest,
  HostEvent,
  decodeHostRpcRequest,
  hostErrorWire,
  PathOutsideRootsError,
  unknownChannel,
  tryDecodeSessionRoster,
  decodeSessionRosterUnknown,
  EMPTY_SESSION_ROSTER,
  encodeSessionRoster,
} from "./index.js"

describe("gharargah-rpc schemas", () => {
  it("round-trips host RPC request defaults", async () => {
    const decoded = await Effect.runPromise(decodeHostRpcRequest({ channel: "fs:stat" }))
    assert.equal(decoded.channel, "fs:stat")
    assert.deepEqual(decoded.args, [])
    assert.equal(decoded.clientId, "browser")
  })

  it("encodes host event", async () => {
    const encoded = await Effect.runPromise(
      Schema.encode(HostEvent)({
        protocolVersion: 1,
        sequence: 3,
        channel: "terminal:data",
        args: ["pty-1", "hi"],
      }),
    )
    assert.equal(encoded.sequence, 3)
    assert.equal(encoded.channel, "terminal:data")
  })

  it("hot-path skips schema for terminal:data", async () => {
    const { isHotPathHostEvent, tryDecodeRealtimeHostEvent, decodeRealtimeHostEvent } =
      await import("./host.js")
    const raw = {
      protocolVersion: 1,
      sequence: 1,
      channel: "terminal:data",
      args: ["id", "x", 1],
    }
    assert.equal(isHotPathHostEvent(raw), true)
    assert.equal(tryDecodeRealtimeHostEvent(raw)?.sequence, 1)
    const viaEffect = await Effect.runPromise(decodeRealtimeHostEvent(raw))
    assert.equal(viaEffect.channel, "terminal:data")
  })

  it("maps path errors to wire codes", () => {
    const wire = hostErrorWire(
      new PathOutsideRootsError({ message: "PATH_OUTSIDE_ALLOWED_ROOTS", path: "/tmp" }),
    )
    assert.equal(wire.code, "PATH_OUTSIDE_ALLOWED_ROOTS")
  })

  it("builds unknown channel error", () => {
    const err = unknownChannel("nope:x")
    assert.equal(err.code, "UNKNOWN_OPERATION")
    assert.match(err.message, /nope:x/)
  })

  it("rejects bad host request", async () => {
    await assert.rejects(() => Effect.runPromise(decodeHostRpcRequest({ args: [] })))
  })

  it("HostRpcRequest schema type is struct", () => {
    assert.ok(HostRpcRequest)
  })
})

describe("SessionRoster compat decode", () => {
  it("round-trips a valid roster via Schema encode", async () => {
    const roster = {
      version: 2 as const,
      sessions: [
        {
          tabId: "gharargah:terminal:a",
          cwdRootUri: "file:///tmp/a",
          label: "Codex",
          status: "running" as const,
          launchCommand: "codex",
          agentId: "codex",
        },
      ],
      modal: { tabId: "gharargah:terminal:a", sessionMode: "terminal" as const },
    }
    const encoded = await Effect.runPromise(encodeSessionRoster(roster))
    const decoded = tryDecodeSessionRoster(encoded)
    assert.deepEqual(decoded, roster)
  })

  it("upgrades version 1 to version 2", () => {
    const decoded = tryDecodeSessionRoster({
      version: 1,
      sessions: [
        {
          tabId: "gharargah:terminal:legacy",
          cwdRootUri: "file:///legacy",
          label: "Shell",
          status: "exited",
        },
      ],
      modal: null,
    })
    assert.equal(decoded?.version, 2)
    assert.equal(decoded?.sessions.length, 1)
  })

  it("returns null for corrupt structure; unknown decode yields empty", () => {
    assert.equal(tryDecodeSessionRoster(null), null)
    assert.equal(tryDecodeSessionRoster({ version: 9, sessions: [] }), null)
    assert.equal(tryDecodeSessionRoster({ version: 2 }), null)
    assert.deepEqual(decodeSessionRosterUnknown({ version: 9 }), EMPTY_SESSION_ROSTER)
    assert.deepEqual(decodeSessionRosterUnknown("nope"), EMPTY_SESSION_ROSTER)
  })

  it("drops agent stub without launchCommand; keeps blank shells", () => {
    const decoded = tryDecodeSessionRoster({
      version: 2,
      sessions: [
        {
          tabId: "gharargah:terminal:blank",
          cwdRootUri: "file:///blank",
          label: "Terminal",
          status: "running",
        },
        {
          tabId: "gharargah:terminal:stub",
          cwdRootUri: "file:///stub",
          label: "Stub",
          status: "starting",
          agentId: "codex",
        },
      ],
      modal: null,
    })
    assert.equal(decoded?.sessions.length, 1)
    assert.equal(decoded?.sessions[0]?.tabId, "gharargah:terminal:blank")
  })

  it("drops native-driver agent sessions without launchCommand", () => {
    const decoded = tryDecodeSessionRoster({
      version: 2,
      sessions: [
        {
          tabId: "gharargah:terminal:native",
          cwdRootUri: "file:///native",
          label: "Codex",
          status: "running",
          agentId: "codex",
          agentDriverId: "codex:app-server",
          agentThreadId: "thread-1",
        },
        {
          tabId: "gharargah:terminal:cli-stub",
          cwdRootUri: "file:///cli-stub",
          label: "Codex",
          status: "starting",
          agentId: "codex",
          agentDriverId: "codex:cli",
        },
      ],
      modal: null,
    })
    assert.equal(decoded?.sessions.length, 0)
  })

  it("clears orphan modal and dedupes tab ids", () => {
    const decoded = tryDecodeSessionRoster({
      version: 2,
      sessions: [
        {
          tabId: "gharargah:terminal:a",
          cwdRootUri: "file:///a",
          label: "A",
          status: "running",
        },
        {
          tabId: "gharargah:terminal:a",
          cwdRootUri: "file:///b",
          label: "Dup",
          status: "failed",
        },
      ],
      modal: { tabId: "gharargah:terminal:missing", sessionMode: "terminal" },
    })
    assert.equal(decoded?.sessions.length, 1)
    assert.equal(decoded?.sessions[0]?.label, "A")
    assert.equal(decoded?.modal, null)
  })

  it("defaults unknown status; maps interrupted; ignores unknown fields", () => {
    const decoded = tryDecodeSessionRoster({
      version: 2,
      sessions: [
        {
          tabId: "gharargah:terminal:a",
          cwdRootUri: "file:///a",
          label: "A",
          status: "weird",
          extraNoise: true,
        },
        {
          tabId: "gharargah:terminal:b",
          cwdRootUri: "file:///b",
          label: "B",
          status: "interrupted",
        },
      ],
      modal: null,
      projects: [{ ignore: true }],
    })
    assert.equal(decoded?.sessions[0]?.status, "starting")
    assert.equal(decoded?.sessions[1]?.status, "failed")
  })

  it("filters non-string launchArgs", () => {
    const decoded = tryDecodeSessionRoster({
      version: 2,
      sessions: [
        {
          tabId: "gharargah:terminal:a",
          cwdRootUri: "file:///a",
          label: "A",
          status: "running",
          launchCommand: "codex",
          launchArgs: ["ok", 12, "also"],
        },
      ],
      modal: null,
    })
    assert.deepEqual(decoded?.sessions[0]?.launchArgs, ["ok", "also"])
  })
})
