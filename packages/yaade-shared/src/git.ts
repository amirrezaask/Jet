export type GitFileStatus =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "untracked"
  | "conflict"

export type GitStatusEntry = {
  path: string
  status: GitFileStatus
  originalPath?: string
  /** True when the index contains a change for this path. */
  staged: boolean
  /** True when the working tree contains a change for this path. */
  unstaged: boolean
  indexStatus?: GitFileStatus
  worktreeStatus?: GitFileStatus
}

export type GitRepositorySummary = {
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
}

export type GitCommit = {
  hash: string
  shortHash: string
  author: string
  authoredAt: number
  subject: string
}
