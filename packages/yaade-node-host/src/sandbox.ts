import fs from "node:fs/promises"
import path from "node:path"

export function normalizeRoots(roots: string[]): string[] {
  return roots.map(root => path.resolve(root))
}

async function realNearestExistingPath(target: string): Promise<string> {
  let current = path.resolve(target)
  const missingSegments: string[] = []
  while (true) {
    try {
      return path.join(await fs.realpath(current), ...missingSegments.reverse())
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code !== "ENOENT" &&
        error.code !== "ENOTDIR"
      ) {
        throw error
      }
      const parent = path.dirname(current)
      if (parent === current) return current
      missingSegments.push(path.basename(current))
      current = parent
    }
  }
}

export async function assertAllowedPath(absPath: string, allowedRoots: string[]): Promise<string> {
  const resolved = path.resolve(absPath)
  const real = await realNearestExistingPath(resolved)

  for (const root of normalizeRoots(allowedRoots)) {
    const realRoot = await realNearestExistingPath(root)
    if (real === realRoot || real.startsWith(realRoot + path.sep)) {
      return real
    }
  }

  throw new Error(`Path not allowed: ${resolved}`)
}

export async function assertAllowedUri(uri: string, allowedRoots: string[], uriToPath: (uri: string) => string): Promise<string> {
  return assertAllowedPath(uriToPath(uri), allowedRoots)
}
