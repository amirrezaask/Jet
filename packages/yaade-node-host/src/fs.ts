import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { pathToUri, uriToPath } from "./paths.js"

export { uriToPath, pathToUri }

/** Reject whole-file reads above this size (editor / Mission Control). */
export const MAX_READ_BYTES = 16 * 1024 * 1024
/** Cap write / temp-drop payloads (aligns with host HTTP JSON body 2 MiB). */
export const MAX_WRITE_BYTES = 2 * 1024 * 1024

export type NodeHostDirEntry = {
  uri: string
  name: string
  isDirectory: boolean
}

export type NodeHostStat = {
  uri: string
  isDirectory: boolean
  size: number
}

export async function readFile(uri: string): Promise<string> {
  const p = uriToPath(uri)
  const fileStat = await fs.stat(p)
  if (fileStat.isDirectory()) {
    throw new Error(`not a file: ${p}`)
  }
  if (fileStat.size > MAX_READ_BYTES) {
    throw new Error(
      `file too large: ${fileStat.size} bytes (max ${MAX_READ_BYTES})`,
    )
  }
  return fs.readFile(p, "utf8")
}

export async function writeFile(uri: string, content: string): Promise<void> {
  const byteLength = Buffer.byteLength(content, "utf8")
  if (byteLength > MAX_WRITE_BYTES) {
    throw new Error(
      `write too large: ${byteLength} bytes (max ${MAX_WRITE_BYTES})`,
    )
  }
  const p = uriToPath(uri)
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, content, "utf8")
}

/** Persist a browser File blob (base64) under the OS temp dir; return absolute path. */
export async function writeTempDrop(name: string, contentBase64: string): Promise<string> {
  // Rough pre-check before allocating the decoded buffer (base64 expands ~4/3).
  if (contentBase64.length > MAX_WRITE_BYTES * 2) {
    throw new Error(`temp drop too large (max ${MAX_WRITE_BYTES} decoded bytes)`)
  }
  const bytes = Buffer.from(contentBase64, "base64")
  if (bytes.byteLength > MAX_WRITE_BYTES) {
    throw new Error(
      `temp drop too large: ${bytes.byteLength} bytes (max ${MAX_WRITE_BYTES})`,
    )
  }
  const dir = path.join(os.tmpdir(), "yaade-drops")
  await fs.mkdir(dir, { recursive: true })
  const safe = path
    .basename(name || "drop.bin")
    .replace(/[^a-zA-Z0-9._-]/g, "_") || "drop.bin"
  const out = path.join(dir, `${randomUUID()}-${safe}`)
  await fs.writeFile(out, bytes)
  return out
}

export async function readDir(uri: string): Promise<NodeHostDirEntry[]> {
  const dirPath = uriToPath(uri)
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  return entries.map(entry => ({
    uri: pathToUri(path.join(dirPath, entry.name)),
    name: entry.name,
    isDirectory: entry.isDirectory(),
  }))
}

export async function stat(uri: string): Promise<NodeHostStat> {
  const p = uriToPath(uri)
  const fileStat = await fs.stat(p)
  return {
    uri,
    isDirectory: fileStat.isDirectory(),
    size: fileStat.size,
  }
}

/** Non-throwing existence probe for expected misses (for example LSP root markers). */
export async function exists(uri: string): Promise<boolean> {
  try {
    await fs.stat(uriToPath(uri))
    return true
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    ) {
      return false
    }
    throw error
  }
}
