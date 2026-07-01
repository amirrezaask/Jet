import { pathToFileUri, fileUriToPath, basename } from "@jet/shared"
import type { FileSystemProvider } from "./types.js"
import { expandHomePath, joinPath } from "./path-input.js"

export { expandHomePath } from "./path-input.js"

export type JetProject = {
  id: string
  path: string
  name: string
}

function normalizeAbsPath(p: string): string {
  return p.replace(/[/\\]+$/, "") || p
}

async function isGitRepo(fs: FileSystemProvider, folderPath: string): Promise<boolean> {
  const gitUri = pathToFileUri(joinPath(folderPath, ".git"))
  try {
    await fs.stat(gitUri)
    return true
  } catch {
    return false
  }
}

export class ProjectRegistry {
  private scanRoots: string[] = []
  private projects: JetProject[] = []

  setScanRoots(roots: string[]): void {
    this.scanRoots = [...roots]
  }

  getScanRoots(): string[] {
    return [...this.scanRoots]
  }

  list(): JetProject[] {
    return [...this.projects]
  }

  async refresh(fs: FileSystemProvider, homeDir: string): Promise<JetProject[]> {
    const found: JetProject[] = []
    const seen = new Set<string>()

    const addIfRepo = async (folderPath: string) => {
      const norm = normalizeAbsPath(folderPath)
      if (seen.has(norm)) return
      seen.add(norm)
      if (!(await isGitRepo(fs, norm))) return
      found.push({ id: norm, path: norm, name: basename(norm) })
    }

    for (const raw of this.scanRoots) {
      const root = expandHomePath(raw, homeDir)
      await addIfRepo(root)
      try {
        const entries = await fs.readDir(pathToFileUri(root))
        for (const entry of entries) {
          if (!entry.isDirectory) continue
          await addIfRepo(fileUriToPath(entry.uri))
        }
      } catch {
        /* unreadable root */
      }
    }

    found.sort((a, b) => a.name.localeCompare(b.name))
    this.projects = found
    return found
  }
}
