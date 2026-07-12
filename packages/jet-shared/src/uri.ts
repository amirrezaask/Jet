declare const FileUriBrand: unique symbol

/** Branded `file://` URI — use {@link pathToFileUri} to construct. */
export type FileUri = string & { readonly [FileUriBrand]: true }

export function isFileUri(uri: string): uri is FileUri {
  return uri.startsWith("file://")
}

export function pathToFileUri(path: string): FileUri {
  const normalized = path.replace(/\\/g, "/")
  if (normalized.startsWith("/")) return `file://${normalized}` as FileUri
  return `file:///${normalized}` as FileUri
}

export function fileUriToPath(uri: string): string {
  if (!uri.startsWith("file://")) return uri
  let path = decodeURIComponent(uri.slice(7))
  // file:///C:/... on Windows
  if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1)
  return path
}

/** Decode + re-encode so LSP/host URIs match Jet `pathToFileUri` form. */
export function canonicalizeFileUri(uri: string): FileUri {
  if (!uri.startsWith("file://")) return uri as FileUri
  return pathToFileUri(fileUriToPath(uri))
}
