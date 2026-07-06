import { pathToFileUri } from "@jet/shared"

export type ProjectRootFs = {
  stat(uri: string): Promise<unknown>
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
): Promise<string | null> {
  if (!fs) return startPath

  let current = startPath
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
    const parent = parentDir(current)
    if (parent === current) break
    current = parent
  }
  return null
}
