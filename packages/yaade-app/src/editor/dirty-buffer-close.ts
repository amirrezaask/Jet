export type DirtyBufferCloseDependencies = {
  choose(uris: readonly string[]): Promise<"save" | "discard" | "cancel">
  save(uri: string): Promise<void>
  discard(uri: string): Promise<void>
}

/**
 * Resolve a whole close operation before mutating layout state. Any failed
 * save/discard aborts the closure so callers never partially close a pane.
 */
export async function resolveDirtyBufferClose(
  uris: readonly string[],
  dependencies: DirtyBufferCloseDependencies,
): Promise<boolean> {
  const unique = [...new Set(uris)]
  if (unique.length === 0) return true
  const decision = await dependencies.choose(unique)
  if (decision === "cancel") return false
  const action = decision === "save" ? dependencies.save : dependencies.discard
  try {
    for (const uri of unique) await action(uri)
    return true
  } catch {
    return false
  }
}
