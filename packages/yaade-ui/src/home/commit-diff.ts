import type { GitCommitFile } from "@yaade/shared"

export type CommitDiffContents = { original: string; modified: string }

type GitApi = NonNullable<NonNullable<typeof window.yaade>["git"]>

/** Prefer the dedicated RPC; fall back to `git:show` at parent vs commit. */
export async function loadCommitDiffContents(
  api: GitApi,
  rootUri: string,
  hash: string,
  file: GitCommitFile,
): Promise<CommitDiffContents> {
  if (typeof api.commitFileContents === "function") {
    try {
      return await api.commitFileContents(rootUri, hash, file)
    } catch {
      // Older hosts may not expose the channel yet — fall through to show.
    }
  }
  if (typeof api.show !== "function") {
    throw new Error("Git show is unavailable; restart the YAADE host.")
  }
  const parent = `${hash}^`
  const oldPath = file.originalPath ?? file.path
  if (file.status === "added") {
    return { original: "", modified: await api.show(rootUri, file.path, hash) }
  }
  if (file.status === "deleted") {
    return { original: await api.show(rootUri, oldPath, parent), modified: "" }
  }
  const [original, modified] = await Promise.all([
    api.show(rootUri, oldPath, parent),
    api.show(rootUri, file.path, hash),
  ])
  if (!original && !modified) {
    throw new Error(
      "Could not read this commit’s file contents. Restart the YAADE host and try again.",
    )
  }
  return { original, modified }
}
