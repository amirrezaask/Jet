/**
 * Claims a cockpit launch request before any side effect runs.
 * Marking first makes React StrictMode and rerenders harmless.
 *
 * A module-level set is required in addition to the component ref: StrictMode
 * remounts wipe the ref, which would otherwise re-run the launch and open a
 * duplicate agent pane (or race the first attempt).
 */
const claimedLaunchIds = new Set<string>()

export function claimMuxLaunchRequest(
  handledIds: Set<string>,
  requestId: string,
): boolean {
  if (handledIds.has(requestId) || claimedLaunchIds.has(requestId)) return false
  handledIds.add(requestId)
  claimedLaunchIds.add(requestId)
  return true
}

/** Undo a claim when the launch side effect failed and should be retried. */
export function releaseMuxLaunchRequest(
  handledIds: Set<string>,
  requestId: string,
): void {
  handledIds.delete(requestId)
  claimedLaunchIds.delete(requestId)
}

/** Test helper — clears the process-wide claim set between cases. */
export function resetMuxLaunchClaimsForTests(): void {
  claimedLaunchIds.clear()
}
