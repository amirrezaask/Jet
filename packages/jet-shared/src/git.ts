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
}
