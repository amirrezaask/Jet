import { canonicalizeFileUri } from "@yaade/shared"

/** Cached or merely mounted Monaco models are not yet valid LSP request targets. */
export function isDocumentOpenForConnection(
  uri: string,
  openUris: Iterable<string> | undefined,
): boolean {
  if (!openUris) return false
  const canonical = canonicalizeFileUri(uri)
  for (const openUri of openUris) {
    if (canonicalizeFileUri(openUri) === canonical) return true
  }
  return false
}
