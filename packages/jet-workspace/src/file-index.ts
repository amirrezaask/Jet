import type { FileSystemProvider } from "./types.js"

const IGNORE_DIRS = new Set([".git", "node_modules", "dist", "dist-electron", ".turbo"])

export async function indexWorkspaceFiles(
  fs: FileSystemProvider,
  rootUri: string,
  maxFiles = 5000,
): Promise<string[]> {
  const results: string[] = []
  const rootPath = rootUri.replace(/^file:\/\//, "")

  async function walk(uri: string, rel: string, depth: number): Promise<void> {
    if (results.length >= maxFiles || depth > 12) return
    let entries
    try {
      entries = await fs.readDir(uri)
    } catch {
      return
    }
    for (const entry of entries) {
      if (results.length >= maxFiles) return
      const entryRel = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory) {
        if (IGNORE_DIRS.has(entry.name)) continue
        await walk(entry.uri, entryRel, depth + 1)
      } else {
        results.push(entryRel)
      }
    }
  }

  await walk(rootUri, "", 0)
  return results.sort()
}

export function fuzzyMatchFiles(query: string, files: string[], limit = 50): string[] {
  if (!query.trim()) return files.slice(0, limit)
  const q = query.toLowerCase()
  const scored: { path: string; score: number }[] = []
  for (const path of files) {
    const lower = path.toLowerCase()
    const idx = lower.indexOf(q)
    if (idx < 0) continue
    const basename = path.split("/").pop() ?? path
    let score = idx
    if (basename.toLowerCase().startsWith(q)) score -= 100
    if (lower === q) score -= 200
    scored.push({ path, score })
  }
  scored.sort((a, b) => a.score - b.score || a.path.localeCompare(b.path))
  return scored.slice(0, limit).map(s => s.path)
}
