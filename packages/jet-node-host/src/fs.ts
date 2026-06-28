import fs from "node:fs/promises"
import path from "node:path"
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
  await fs.writeFile(uriToPath(uri), content, "utf8")
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
