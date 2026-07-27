import { fileUriToPath } from "@gharargah/shared"

/** Normalize a path relative to a workspace root, or return absolute paths unchanged. */
export function resolvePathUnderRoot(rootPath: string, inputPath: string): string {
  const trimmed = inputPath.trim()
  if (trimmed.startsWith("file://")) return fileUriToPath(trimmed)
  if (trimmed.startsWith("/") || /^[A-Za-z]:[\\/]/.test(trimmed)) return trimmed
  const sep = rootPath.includes("\\") ? "\\" : "/"
  const base = rootPath.replace(/[/\\]+$/, "")
  const rel = trimmed.replace(/^[/\\]+/, "").replace(/^\.\//, "")
  return `${base}${sep}${rel.split(/[/\\]/).join(sep)}`
}

/** True when `candidate` is the same as or nested under `rootPath`. */
export function isPathUnderRoot(rootPath: string, candidate: string): boolean {
  const normRoot = rootPath.replace(/[/\\]+$/, "")
  const normCandidate = candidate.replace(/[/\\]+$/, "")
  if (normCandidate === normRoot) return true
  const sep = normRoot.includes("\\") ? "\\" : "/"
  return normCandidate.startsWith(`${normRoot}${sep}`)
}
