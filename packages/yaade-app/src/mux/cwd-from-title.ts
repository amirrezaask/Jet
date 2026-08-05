import { fileUriToPath, pathToFileUri } from "@yaade/shared"

/**
 * Best-effort absolute directory from a shell OSC/window title.
 * Common forms: `/Users/x/proj`, `~/proj`, `user@host:~/proj`, `proj`.
 */
export function cwdUriFromTerminalTitle(
  title: string,
  homeDir: string,
): string | null {
  const raw = title.trim()
  if (!raw || raw.length > 1024) return null

  let candidate = raw
  // user@host:path (ssh-style / bash \w titles)
  const hostSep = candidate.lastIndexOf(":")
  if (hostSep > 0 && !candidate.includes("://")) {
    const maybeHost = candidate.slice(0, hostSep)
    if (maybeHost.includes("@") || /^[\w.-]+$/.test(maybeHost)) {
      candidate = candidate.slice(hostSep + 1).trim()
    }
  }

  if (candidate.startsWith("file://")) {
    try {
      const path = fileUriToPath(candidate)
      return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)
        ? pathToFileUri(path)
        : null
    } catch {
      return null
    }
  }

  if (candidate.startsWith("~/") || candidate === "~") {
    const home = homeDir.replace(/[/\\]+$/, "")
    candidate = candidate === "~" ? home : `${home}${candidate.slice(1)}`
  }

  // Absolute unix or windows path only — ignore bare basenames / command names.
  if (!(candidate.startsWith("/") || /^[A-Za-z]:[\\/]/.test(candidate))) {
    return null
  }

  // Strip trailing prompt junk occasionally glued onto titles.
  candidate = candidate.replace(/[%$#>]\s*$/, "").trim()
  if (!candidate) return null
  return pathToFileUri(candidate)
}
