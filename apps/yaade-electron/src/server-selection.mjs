import fs from "node:fs"
import path from "node:path"

export const SERVER_SELECTION_FILENAME = "server-selection.json"

/**
 * Yaade servers own the SPA and API at their origin. Keeping the selection
 * origin-only prevents silently dropping reverse-proxy path prefixes.
 *
 * @param {string} value
 */
export function normalizeServerUrl(value) {
  const trimmed = value.trim()
  if (!trimmed) throw new Error("Enter a server URL")

  let url
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error("Enter a valid http:// or https:// server URL")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Server URL must use http:// or https://")
  }
  if (url.username || url.password) {
    throw new Error("Server URL must not include credentials")
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Server URL must not include a path, query, or fragment")
  }
  return url.origin
}

/**
 * @param {string} configPath
 * @returns {string | null}
 */
export function readServerSelection(configPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"))
    return typeof parsed.serverUrl === "string" ? normalizeServerUrl(parsed.serverUrl) : null
  } catch {
    return null
  }
}

/**
 * @param {string} configPath
 * @param {string | null} serverUrl
 */
export function writeServerSelection(configPath, serverUrl) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  const tempPath = `${configPath}.tmp`
  fs.writeFileSync(
    tempPath,
    `${JSON.stringify({ serverUrl, version: 1 }, null, 2)}\n`,
    { mode: 0o600 },
  )
  fs.renameSync(tempPath, configPath)
}
