import fs from "node:fs/promises"
import path from "node:path"

export function normalizeRoots(roots: string[]): string[] {
  return roots.map(root => path.resolve(root))
}

export async function assertAllowedPath(absPath: string, allowedRoots: string[]): Promise<string> {
  const resolved = path.resolve(absPath)
  const real = await fs.realpath(resolved).catch(() => resolved)

  for (const root of normalizeRoots(allowedRoots)) {
    const realRoot = await fs.realpath(root).catch(() => root)
    if (real === realRoot || real.startsWith(realRoot + path.sep)) {
      return real
    }
  }

  throw new Error(`Path not allowed: ${resolved}`)
}

export async function assertAllowedUri(uri: string, allowedRoots: string[], uriToPath: (uri: string) => string): Promise<string> {
  return assertAllowedPath(uriToPath(uri), allowedRoots)
}
