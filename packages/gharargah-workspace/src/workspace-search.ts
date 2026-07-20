import { pathToFileUri } from "@gharargah/shared"
import type { ProjectSearchResult } from "@gharargah/shared"
import type { WorkspaceFolder } from "./workspace-manager.js"
import { joinPath } from "./path-input.js"

export type FolderSearchState = {
  supported: boolean
  scanReady: boolean
}

export type FolderSearchHit = {
  folder: WorkspaceFolder
  relativePath: string
  displayPath: string
}

export type ProjectSearchHit = {
  folder: WorkspaceFolder
  result: ProjectSearchResult
}

export function aggregateFolderSearchState(
  folders: WorkspaceFolder[],
  states: ReadonlyMap<string, FolderSearchState>,
): { supported: boolean; scanReady: boolean } {
  if (folders.length === 0) return { supported: false, scanReady: false }

  const supportedFolders = folders.filter(f => states.get(f.id)?.supported)
  if (supportedFolders.length === 0) {
    return { supported: false, scanReady: folders.length > 0 }
  }

  const scanReady = supportedFolders.some(f => states.get(f.id)?.scanReady)
  return { supported: true, scanReady }
}

export function formatQuickOpenDisplayPath(
  folder: WorkspaceFolder,
  relativePath: string,
  multiRoot: boolean,
): string {
  const rel = relativePath.replace(/^[/\\]+/, "")
  if (!multiRoot) return rel
  return rel ? `${folder.root.name}/${rel}` : folder.root.name
}

export function resolveQuickOpenDisplayPath(
  displayPath: string,
  folders: WorkspaceFolder[],
): { folder: WorkspaceFolder; relativePath: string; fullPath: string; fileUri: string } | null {
  if (folders.length === 0) return null

  if (folders.length === 1) {
    const folder = folders[0]!
    const rel = displayPath.replace(/^[/\\]+/, "")
    const fullPath = joinPath(folder.root.path, rel)
    return { folder, relativePath: rel, fullPath, fileUri: pathToFileUri(fullPath) }
  }

  for (const folder of folders) {
    const prefix = `${folder.root.name}/`
    if (displayPath === folder.root.name) {
      return {
        folder,
        relativePath: "",
        fullPath: folder.root.path,
        fileUri: folder.root.uri,
      }
    }
    if (displayPath.startsWith(prefix)) {
      const rel = displayPath.slice(prefix.length)
      const fullPath = joinPath(folder.root.path, rel)
      return { folder, relativePath: rel, fullPath, fileUri: pathToFileUri(fullPath) }
    }
  }

  return null
}

export function relativePathInFolder(
  folderPath: string,
  absolutePath: string,
): string | undefined {
  const normRoot = folderPath.replace(/[/\\]+$/, "")
  const normFile = absolutePath.replace(/[/\\]+$/, "")
  const sep = normRoot.includes("\\") ? "\\" : "/"
  if (normFile === normRoot) return ""
  const prefix = `${normRoot}${sep}`
  if (!normFile.startsWith(prefix)) return undefined
  return normFile.slice(prefix.length)
}

type FileSearchApi = {
  fileSearch(
    rootUri: string,
    query: string,
    opts?: { pageSize?: number; currentFile?: string },
  ): Promise<string[]>
}

type ProjectSearchApi = {
  project(
    rootUri: string,
    query: string,
    opts?: { caseSensitive?: boolean; regex?: boolean; fuzzy?: boolean },
  ): Promise<ProjectSearchResult[]>
}

export async function fileSearchAcrossFolders(
  folders: WorkspaceFolder[],
  search: FileSearchApi,
  query: string,
  opts?: {
    pageSize?: number
    currentFile?: { folderId: string; relativePath: string }
  },
): Promise<string[]> {
  if (folders.length === 0) return []

  const multiRoot = folders.length > 1
  const pageSize = opts?.pageSize ?? 100
  const perFolder = multiRoot
    ? Math.max(20, Math.ceil(pageSize / folders.length))
    : pageSize

  const batches = await Promise.all(
    folders.map(async folder => {
      const currentFile =
        opts?.currentFile?.folderId === folder.id ? opts.currentFile.relativePath : undefined
      const hits = await search.fileSearch(folder.root.uri, query, {
        pageSize: perFolder,
        currentFile,
      })
      return hits.map(relativePath => ({
        folder,
        relativePath,
        displayPath: formatQuickOpenDisplayPath(folder, relativePath, multiRoot),
      }))
    }),
  )

  const merged = batches.flat()
  const seen = new Set<string>()
  const unique: FolderSearchHit[] = []
  for (const hit of merged) {
    const key = `${hit.folder.id}:${hit.relativePath}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(hit)
  }

  return unique.slice(0, pageSize).map(hit => hit.displayPath)
}

export async function projectSearchAcrossFolders(
  folders: WorkspaceFolder[],
  search: ProjectSearchApi,
  query: string,
  opts?: { caseSensitive?: boolean; regex?: boolean; fuzzy?: boolean },
): Promise<ProjectSearchHit[]> {
  if (!query.trim() || folders.length === 0) return []

  const batches = await Promise.all(
    folders.map(async folder => {
      const results = await search.project(folder.root.uri, query, opts)
      return results.map(result => ({ folder, result }))
    }),
  )

  return batches.flat()
}
