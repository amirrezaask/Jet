import { canonicalizeFileUri } from "@yaade/shared"

export function lspConnectionMatchesDocument(
  documentUri: string,
  documentLanguageId: string,
  connectionRootUri: string,
  connectionLanguageIds: readonly string[],
): boolean {
  if (!connectionLanguageIds.includes(documentLanguageId)) return false
  if (!documentUri.startsWith("file://")) return false
  const root = canonicalizeFileUri(connectionRootUri).replace(/\/+$/, "")
  const uri = canonicalizeFileUri(documentUri)
  return uri === root || uri.startsWith(`${root}/`)
}
