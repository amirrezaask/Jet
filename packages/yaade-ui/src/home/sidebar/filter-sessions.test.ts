import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  filterProjectsBySessionQuery,
  filterSessionsByQuery,
  sessionMatchesQuery,
} from "./filter-sessions.js"
import { sameProjectPath } from "./project-path.js"
import type { SidebarProject, SidebarSession } from "./types.js"

const s = (partial: Partial<SidebarSession> & { id: string }): SidebarSession => ({
  projectId: "p1",
  projectName: "Gharagah Core",
  projectPath: "/Users/dev/gharagah-core",
  title: "Refactor lifecycle",
  agent: "claude",
  agentLabel: "Claude",
  status: "completed",
  unreadCount: 0,
  lastActivityAt: "2026-07-28T10:00:00Z",
  isPinned: false,
  panelId: { id: 1 },
  ...partial,
})

describe("session search", () => {
  it("matches title, project, agent, path", () => {
    const session = s({ id: "1" })
    assert.equal(sessionMatchesQuery(session, "refactor"), true)
    assert.equal(sessionMatchesQuery(session, "core"), true)
    assert.equal(sessionMatchesQuery(session, "claude"), true)
    assert.equal(sessionMatchesQuery(session, "gharagah-core"), true)
    assert.equal(sessionMatchesQuery(session, "zzz"), false)
  })

  it("filters flat list while preserving order", () => {
    const list = [
      s({ id: "1", title: "ACP reconnect", agent: "codex", agentLabel: "Codex" }),
      s({
        id: "2",
        title: "Terminal resize",
        agent: "opencode",
        agentLabel: "OpenCode",
      }),
    ]
    assert.deepEqual(
      filterSessionsByQuery(list, "acp").map(x => x.id),
      ["1"],
    )
  })

  it("hides projects with no matching sessions", () => {
    const projects: SidebarProject[] = [
      {
        id: "p1",
        name: "Core",
        path: "/core",
        rootUri: "file:///core",
        sessions: [s({ id: "1", title: "ACP" })],
        hasActive: false,
        lastAccessedAt: "2026-07-28T10:00:00Z",
        unreadCount: 0,
      },
      {
        id: "p2",
        name: "Web",
        path: "/web",
        rootUri: "file:///web",
        sessions: [
          s({ id: "2", title: "CSS polish", projectId: "p2", projectName: "Web" }),
        ],
        hasActive: false,
        lastAccessedAt: "2026-07-28T10:00:00Z",
        unreadCount: 0,
      },
    ]
    const filtered = filterProjectsBySessionQuery(projects, "acp")
    assert.deepEqual(
      filtered.map(p => p.id),
      ["p1"],
    )
    assert.equal(filtered[0]?.sessions.length, 1)
  })
})

describe("sameProjectPath", () => {
  it("matches macOS /var and /private/var aliases", () => {
    assert.equal(
      sameProjectPath("/var/folders/run/project", "/private/var/folders/run/project"),
      true,
    )
  })

  it("keeps distinct project paths distinct", () => {
    assert.equal(sameProjectPath("/tmp/alpha", "/tmp/beta"), false)
  })
})
