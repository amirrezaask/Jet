import assert from "node:assert/strict"
import { describe, it } from "node:test"
import * as Registry from "@effect-atom/atom/Registry"
import { notificationCenterAtom, openTerminalTabIdAtom, rosterAtom } from "./atoms.js"

describe("effect atoms", () => {
  it("rosterAtom write updates sessions", () => {
    const registry = Registry.make()
    registry.set(rosterAtom, {
      version: 2,
      sessions: [
        {
          tabId: "t1",
          cwdRootUri: "file:///tmp",
          label: "term",
          status: "running",
        },
      ],
      modal: null,
    })
    const roster = registry.get(rosterAtom)
    assert.equal(roster.sessions.length, 1)
    assert.equal(roster.sessions[0]?.tabId, "t1")
  })

  it("openTerminalTabIdAtom mirrors modal", () => {
    const registry = Registry.make()
    registry.set(rosterAtom, {
      version: 2,
      sessions: [
        {
          tabId: "t1",
          cwdRootUri: "file:///tmp",
          label: "term",
          status: "running",
        },
      ],
      modal: null,
    })
    registry.set(openTerminalTabIdAtom, "t1")
    assert.equal(registry.get(openTerminalTabIdAtom), "t1")
    assert.equal(registry.get(rosterAtom).modal?.tabId, "t1")
  })

  it("notificationCenterAtom defaults", () => {
    const registry = Registry.make()
    assert.equal(registry.get(notificationCenterAtom).unreadCount, 0)
    registry.set(notificationCenterAtom, { unreadCount: 3, lastEventAt: "now" })
    assert.equal(registry.get(notificationCenterAtom).unreadCount, 3)
  })
})
