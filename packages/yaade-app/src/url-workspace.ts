/**
 * Browser URL → project root under $HOME.
 *
 * `http://localhost:5174/dev/consultation` → `{home}/dev/consultation`
 * `/` → home itself (caller may fall back to launchConfig).
 */

const RESERVED_PREFIXES = [
  "/api",
  "/ws",
  "/health",
  "/@",
  "/node_modules",
  "/src",
  "/assets",
]

/** True when pathname is a Vite/host asset or API route, not a project path. */
export function isReservedWorkspacePathname(pathname: string): boolean {
  if (pathname === "/" || pathname === "") return false
  const lower = pathname.toLowerCase()
  for (const prefix of RESERVED_PREFIXES) {
    if (lower === prefix || lower.startsWith(`${prefix}/`)) return true
  }
  // Vite hashed assets / source maps
  if (/\.[a-z0-9]{1,8}$/i.test(pathname) && !pathname.includes("/")) return true
  return false
}

/**
 * Join home + URL pathname segments. Leading slashes are stripped so the path
 * is always under `homeDir` (never absolute-from-root via pathname).
 */
export function resolveHomeRelativePath(
  homeDir: string,
  pathname: string,
): string {
  const home = homeDir.replace(/\/+$/, "") || "/"
  const rel = pathname.replace(/^\/+/, "").replace(/\/+$/, "")
  if (!rel) return home
  // Avoid path traversal escaping home.
  const parts = rel.split("/").filter(p => p.length > 0 && p !== ".")
  const safe: string[] = []
  for (const part of parts) {
    if (part === "..") {
      if (safe.length > 0) safe.pop()
      continue
    }
    safe.push(part)
  }
  if (safe.length === 0) return home
  return `${home}/${safe.join("/")}`
}

/** Short document title for a project root. */
export function workspaceDocumentTitle(
  absolutePath: string,
  homeDir: string,
): string {
  const home = homeDir.replace(/\/+$/, "")
  if (home && (absolutePath === home || absolutePath.startsWith(`${home}/`))) {
    const rel = absolutePath.slice(home.length).replace(/^\//, "")
    return rel ? `~/${rel}` : "~"
  }
  const base = absolutePath.split("/").filter(Boolean).pop()
  return base || absolutePath || "YAADE"
}

/**
 * Map the current location to an absolute project root.
 * Returns `null` when the pathname is reserved (asset/API) — caller should not navigate.
 */
export function projectRootFromLocation(
  homeDir: string,
  pathname: string = typeof location !== "undefined" ? location.pathname : "/",
): string | null {
  if (isReservedWorkspacePathname(pathname)) return null
  return resolveHomeRelativePath(homeDir, pathname)
}

/** Home-relative URL path for an absolute filesystem path (for `window.open`). */
export function urlPathForProjectRoot(
  absolutePath: string,
  homeDir: string,
): string {
  const home = homeDir.replace(/\/+$/, "")
  const abs = absolutePath.replace(/\/+$/, "") || "/"
  if (!home) return "/"
  if (abs === home) return "/"
  if (abs.startsWith(`${home}/`)) {
    return `/${abs.slice(home.length + 1)}`
  }
  // Outside home — still open `/` (caller may use a different affordance).
  return "/"
}
