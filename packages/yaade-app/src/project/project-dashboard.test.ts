import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { ProjectSessionSummary } from "@yaade/rpc"
import {
  loadProjectDashboard,
  recentProjectSessions,
  resolveProjectFilePath,
  visibleLinkedWorktrees,
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

  it("limits linked worktrees and excludes Main", () => {
    const rows = Array.from({ length: 7 }, (_, index) => ({
      path: index === 0 ? "/home/dev/repo" : `/home/.yaade/wt-${index}`,
      head: null,
      branch: `refs/heads/wt-${index}`,
      bare: false,
      detached: false,
      locked: false,
      prunable: false,
    }))
    assert.deepEqual(
      visibleLinkedWorktrees(rows, "/home/dev/repo").map(row => row.path),
      ["/home/.yaade/wt-1", "/home/.yaade/wt-2", "/home/.yaade/wt-3", "/home/.yaade/wt-4"],
    )
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
        summary: async () => ({ branch: "main", upstream: "origin/main", ahead: 0, behind: 0 }),
        status: async () => {
          throw new Error("status failed")
        },
        worktreeList: async () => [],
        defaultBranch: async () => "main",
      },
    })
    assert.equal(dashboard.readme.value, "# Repo")
    assert.equal(dashboard.sessions.value.length, 1)
    assert.equal(dashboard.summary.value?.branch, "main")
    assert.equal(dashboard.status.value, null)
    assert.match(dashboard.status.error ?? "", /status failed/)
  })

  it("models non-Git projects without section errors", async () => {
    const dashboard = await loadProjectDashboard("/home/dev/plain", {
      listSessions: async () => [],
      git: {
        isRepo: async () => false,
        summary: async () => { throw new Error("must not run") },
        status: async () => { throw new Error("must not run") },
        worktreeList: async () => { throw new Error("must not run") },
        defaultBranch: async () => { throw new Error("must not run") },
      },
    })
    assert.equal(dashboard.isGitRepo.value, false)
    assert.equal(dashboard.isGitRepo.error, null)
    assert.equal(dashboard.status.error, null)
  })
})
