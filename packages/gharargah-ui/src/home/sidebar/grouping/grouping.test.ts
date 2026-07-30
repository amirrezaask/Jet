import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  applyGrouping,
  applyStickySelectedOrder,
  sortProjects,
  sortSessionsInProject,
  sortSessionsUnreadFirst,
} from "./index.js"
import type { SidebarProject, SidebarSession } from "../types.js"

function session(
  partial: Partial<SidebarSession> & Pick<SidebarSession, "id" | "agent">,
): SidebarSession {
  return {
    projectId: "p1",
    projectName: "Core",
    projectPath: "/core",
    title: `Session ${partial.id}`,
    agentLabel: partial.agent,
    status: "completed",
    unreadCount: 0,
    lastActivityAt: "2026-07-28T10:00:00Z",
    isPinned: false,
    panelId: { id: 1 },
    ...partial,
  }
}

describe("sortSessionsUnreadFirst", () => {
  it("produces one flat list: unread first, then by activity — never groups by agent", () => {
    const input = [
      session({
        id: "1",
        agent: "codex",
        unreadCount: 2,
        lastActivityAt: "2026-07-28T10:00:00Z",
      }),
      session({
        id: "2",
        agent: "claude",
        unreadCount: 1,
        lastActivityAt: "2026-07-28T09:00:00Z",
      }),
      session({
        id: "3",
        agent: "codex",
        unreadCount: 0,
        lastActivityAt: "2026-07-28T11:00:00Z",
      }),
    ]
    const sorted = sortSessionsUnreadFirst(input)
    assert.deepEqual(
      sorted.map(s => s.id),
      ["1", "2", "3"],
    )
    assert.deepEqual(
      sorted.map(s => s.agent),
      ["codex", "claude", "codex"],
    )
  })

  it("sorts unread bucket by latest activity descending", () => {
    const sorted = sortSessionsUnreadFirst([
      session({
        id: "old",
        agent: "claude",
        unreadCount: 1,
        lastActivityAt: "2026-07-28T08:00:00Z",
      }),
      session({
        id: "new",
        agent: "codex",
        unreadCount: 3,
        lastActivityAt: "2026-07-28T12:00:00Z",
      }),
    ])
    assert.deepEqual(
      sorted.map(s => s.id),
      ["new", "old"],
    )
  })
})

describe("unreadFirstGrouping", () => {
  it("returns a single unlabeled flat group", () => {
    const sessions = [
      session({ id: "1", agent: "codex", unreadCount: 1 }),
      session({ id: "2", agent: "claude", unreadCount: 0 }),
    ]
    const groups = applyGrouping("unread-first", [], sessions)
    assert.equal(groups.length, 1)
    assert.equal(groups[0]?.id, "all-sessions")
    assert.equal(groups[0]?.label, undefined)
    assert.deepEqual(
      groups[0]?.sessions.map(s => s.id),
      ["1", "2"],
    )
  })
})

describe("project grouping + sorting", () => {
  it("sorts projects unread → active → recent → alpha", () => {
    const projects: SidebarProject[] = [
      {
        id: "alpha",
        name: "Alpha",
        path: "/a",
        rootUri: "file:///a",
        sessions: [],
        hasActive: false,
        lastAccessedAt: "2026-07-28T01:00:00Z",
        unreadCount: 0,
      },
      {
        id: "unread",
        name: "Unread Proj",
        path: "/u",
        rootUri: "file:///u",
        sessions: [],
        hasActive: false,
        lastAccessedAt: "2026-07-28T01:00:00Z",
        unreadCount: 2,
      },
      {
        id: "active",
        name: "Active Proj",
        path: "/act",
        rootUri: "file:///act",
        sessions: [],
        hasActive: true,
        lastAccessedAt: "2026-07-28T01:00:00Z",
        unreadCount: 0,
      },
    ]
    assert.deepEqual(sortProjects(projects).map(p => p.id), [
      "unread",
      "active",
      "alpha",
    ])
  })

  it("sorts sessions inside a project open before done, then unread → active → recent", () => {
    const sorted = sortSessionsInProject([
      session({
        id: "done",
        agent: "codex",
        status: "completed",
        doneAt: "2026-07-28T13:00:00Z",
        unreadCount: 0,
        lastActivityAt: "2026-07-28T13:00:00Z",
      }),
      session({
        id: "idle",
        agent: "terminal",
        status: "disconnected",
        unreadCount: 0,
        lastActivityAt: "2026-07-28T12:00:00Z",
      }),
      session({
        id: "run",
        agent: "claude",
        status: "running",
        unreadCount: 0,
        lastActivityAt: "2026-07-28T10:00:00Z",
      }),
      session({
        id: "unread",
        agent: "codex",
        status: "disconnected",
        unreadCount: 1,
        lastActivityAt: "2026-07-28T09:00:00Z",
      }),
    ])
    assert.deepEqual(
      sorted.map(s => s.id),
      ["unread", "run", "idle", "done"],
    )
  })

  it("groups sessions under projects", () => {
    const p1: SidebarProject = {
      id: "p1",
      name: "Core",
      path: "/core",
      rootUri: "file:///core",
      sessions: [
        session({ id: "s1", agent: "claude", projectId: "p1", unreadCount: 1 }),
      ],
      hasActive: false,
      lastAccessedAt: "2026-07-28T10:00:00Z",
      unreadCount: 1,
    }
    const p2: SidebarProject = {
      id: "p2",
      name: "Web",
      path: "/web",
      rootUri: "file:///web",
      sessions: [
        session({ id: "s2", agent: "codex", projectId: "p2", unreadCount: 0 }),
      ],
      hasActive: true,
      lastAccessedAt: "2026-07-28T11:00:00Z",
      unreadCount: 0,
    }
    const groups = applyGrouping("project", [p1, p2], [
      ...p1.sessions,
      ...p2.sessions,
    ])
    assert.deepEqual(
      groups.map(g => g.id),
      ["p1", "p2"],
    )
    assert.deepEqual(
      groups[0]?.sessions.map(s => s.id),
      ["s1"],
    )
  })
})

describe("applyStickySelectedOrder", () => {
  it("keeps selected session at prior index after unread clears", () => {
    const previous = ["2", "1", "3"]
    const resorted = [
      session({ id: "2", agent: "claude", unreadCount: 1 }),
      session({ id: "3", agent: "codex", unreadCount: 0 }),
      session({ id: "1", agent: "codex", unreadCount: 0 }),
    ]
    // Selected "1" was at index 1; keep it there despite natural re-sort.
    const sticky = applyStickySelectedOrder(resorted, previous, "1")
    assert.deepEqual(
      sticky.map(s => s.id),
      ["2", "1", "3"],
    )
  })
})
