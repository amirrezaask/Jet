import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { ProjectSessionSummary } from "@yaade/rpc"
import {
  loadProjectDashboard,
  recentProjectSessions,
  resolveProjectFilePath,
} from "./project-dashboard.js"

function session(
  id: string,
  updatedAt: string,
  archivedAt: string | null = null,
): ProjectSessionSummary {
  return {
    id,
    machine: "test",
    projectPath: "/home/dev/repo",
    cwdPath: "/home/dev/repo",
    title: id,
    worktreeBranch: null,
    worktreePath: null,
    createdAt: updatedAt,
    updatedAt,
    archivedAt,
  }
}

describe("project dashboard", () => {
  it("sorts, filters, and limits recent sessions", () => {
    const rows = [
      session("old", "2026-01-01T00:00:00.000Z"),
      session("archived", "2026-04-01T00:00:00.000Z", "2026-04-02T00:00:00.000Z"),
      session("new", "2026-03-01T00:00:00.000Z"),
      session("middle", "2026-02-01T00:00:00.000Z"),
    ]
    assert.deepEqual(
      recentProjectSessions(rows, 2).map(row => row.id),
      ["new", "middle"],
    )
  })

  it("keeps safe project-relative files inside the project", () => {
    assert.equal(
      resolveProjectFilePath("/home/dev/repo", "src/app.ts#L12"),
      "/home/dev/repo/src/app.ts",
    )
    assert.equal(resolveProjectFilePath("/home/dev/repo", "../secret"), null)
    assert.equal(resolveProjectFilePath("/home/dev/repo", "/etc/passwd"), null)
    assert.equal(resolveProjectFilePath("/home/dev/repo", "https://example.com"), null)
    assert.equal(resolveProjectFilePath("/home/dev/repo", "%ZZ"), null)
  })

  it("preserves partial results when one Git source fails", async () => {
    const dashboard = await loadProjectDashboard("/home/dev/repo", {
      listSessions: async () => [session("main", "2026-03-01T00:00:00.000Z")],
      fs: {
        readDir: async () => [{ name: "README.md", isDirectory: false }],
        readFile: async () => "# Repo",
      },
      git: {
        isRepo: async () => true,
        branch: async () => "main",
        branches: async () => {
          throw new Error("branches failed")
        },
        history: async () => [{
          hash: "abc1234",
          shortHash: "abc1234",
          author: "Tester",
          authoredAt: Date.parse("2026-03-01T00:00:00.000Z"),
          subject: "feat: add project overview",
        }],
      },
    })
    assert.equal(dashboard.readme.value, "# Repo")
    assert.equal(dashboard.sessions.value.length, 1)
    assert.equal(dashboard.branch.value, "main")
    assert.equal(dashboard.history.value?.[0]?.subject, "feat: add project overview")
    assert.equal(dashboard.branches.value, null)
    assert.match(dashboard.branches.error ?? "", /branches failed/)
  })

  it("models non-Git projects without section errors", async () => {
    const dashboard = await loadProjectDashboard("/home/dev/plain", {
      listSessions: async () => [],
      git: {
        isRepo: async () => false,
        branch: async () => { throw new Error("must not run") },
        branches: async () => { throw new Error("must not run") },
        history: async () => { throw new Error("must not run") },
      },
    })
    assert.equal(dashboard.isGitRepo.value, false)
    assert.equal(dashboard.isGitRepo.error, null)
    assert.equal(dashboard.history.error, null)
    assert.equal(dashboard.branches.error, null)
  })
})
