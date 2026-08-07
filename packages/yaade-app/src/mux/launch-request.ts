/**
 * Claims a cockpit launch request before any side effect runs.
 * Marking first makes React StrictMode and rerenders harmless.
 */
export function claimMuxLaunchRequest(
  handledIds: Set<string>,
  requestId: string,
): boolean {
  if (handledIds.has(requestId)) return false
  handledIds.add(requestId)
  return true
}
