import { normalizeAbsPath, type WorkspaceFolder } from "@jet/workspace"

export const PROJECT_CATALOG_STORAGE_KEY = "jet-project-catalog-v1"

export type PersistedProjectCatalog = {
  version: 1
  projects: Array<{ path: string }>
  activePath: string | null
}

const EMPTY_CATALOG: PersistedProjectCatalog = {
  version: 1,
  projects: [],
  activePath: null,
}

function normalizedPath(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null
  return normalizeAbsPath(value.trim())
}

export function readProjectCatalog(
  storage: Pick<Storage, "getItem"> = localStorage,
): PersistedProjectCatalog {
  try {
    const raw = storage.getItem(PROJECT_CATALOG_STORAGE_KEY)
    if (!raw) return EMPTY_CATALOG
    const parsed = JSON.parse(raw) as Partial<PersistedProjectCatalog>
    if (parsed.version !== 1 || !Array.isArray(parsed.projects)) return EMPTY_CATALOG

    const seen = new Set<string>()
    const projects: Array<{ path: string }> = []
    for (const item of parsed.projects) {
      const path = normalizedPath(item?.path)
      if (!path || seen.has(path)) continue
      seen.add(path)
      projects.push({ path })
    }
    const activePath = normalizedPath(parsed.activePath)
    return {
      version: 1,
      projects,
      activePath: activePath && seen.has(activePath) ? activePath : projects[0]?.path ?? null,
    }
  } catch {
    return EMPTY_CATALOG
  }
}

export function writeProjectCatalog(
  folders: WorkspaceFolder[],
  activeFolderId: string | null,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  const active = folders.find(folder => folder.id === activeFolderId)
  const catalog: PersistedProjectCatalog = {
    version: 1,
    projects: folders.map(folder => ({ path: normalizeAbsPath(folder.root.path) })),
    activePath: active ? normalizeAbsPath(active.root.path) : null,
  }
  try {
    storage.setItem(PROJECT_CATALOG_STORAGE_KEY, JSON.stringify(catalog))
  } catch {
    /* localStorage may be disabled; the in-memory workspace still works. */
  }
}
