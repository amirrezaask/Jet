import { pathToFileUri } from "@yaade/shared"

export type ProjectRootFs = {
  stat(uri: string): Promise<unknown>
}

function comparablePath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "")
  return /^[A-Za-z]:\//.test(normalized) ? normalized.toLowerCase() : normalized
}

export function parentDir(absPath: string): string {
  const parent = absPath.replace(/[/\\][^/\\]+$/, "")
  return parent === absPath ? absPath : parent
}

/** Walk upward from `startPath` until a directory contains one of `markers`. */
export async function findProjectRoot(
  startPath: string,
  markers: string[],
  fs: ProjectRootFs | null | undefined,
  stopAtPath?: string,
): Promise<string | null> {
  if (!fs) return startPath

  let current = startPath
  const boundary = stopAtPath ? comparablePath(stopAtPath) : null
  for (let i = 0; i < 20; i++) {
    for (const marker of markers) {
      try {
        const uri = pathToFileUri(`${current}/${marker}`)
        await fs.stat(uri)
        return current
      } catch {
        /* continue */
      }
    }
    if (boundary && comparablePath(current) === boundary) break
    const parent = parentDir(current)
    if (parent === current) break
    if (
      boundary &&
      comparablePath(parent) !== boundary &&
      !comparablePath(parent).startsWith(`${boundary}/`)
    ) {
      break
    }
    current = parent
  }
  return null
}
