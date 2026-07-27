import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { pathToUri, uriToPath } from "./paths.js"

export { uriToPath, pathToUri }

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
  return fs.readFile(uriToPath(uri), "utf8")
}

export async function writeFile(uri: string, content: string): Promise<void> {
  const p = uriToPath(uri)
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, content, "utf8")
}

/** Persist a browser File blob (base64) under the OS temp dir; return absolute path. */
export async function writeTempDrop(name: string, contentBase64: string): Promise<string> {
  const bytes = Buffer.from(contentBase64, "base64")
  const dir = path.join(os.tmpdir(), "gharargah-drops")
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
