import path from "node:path"

export function uriToPath(uri: string): string {
  if (uri.startsWith("file://")) {
    const p = decodeURIComponent(uri.slice(7))
    return process.platform === "win32" && p.startsWith("/") ? p.slice(1) : p
  }
  return uri
}

export function pathToUri(p: string): string {
  const normalized = p.replace(/\\/g, "/")
  const resolved = path.resolve(normalized).replace(/\\/g, "/")
  if (resolved.startsWith("/")) return `file://${resolved}`
  return `file:///${resolved}`
}
