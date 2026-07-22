import type { WorkspaceFolder } from "@gharargah/workspace"

type ServerProject = { id: string; name: string; rootPath: string }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  if (!response.ok) throw new Error(`Jet project API failed (${response.status})`)
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export async function loadServerProjectPaths(): Promise<string[]> {
  const projects = await request<ServerProject[]>("/api/v1/projects")
  return projects.map(project => project.rootPath)
}

export async function syncServerProjectCatalog(folders: WorkspaceFolder[]): Promise<void> {
  const projects = await request<ServerProject[]>("/api/v1/projects")
  const desired = new Set(folders.map(folder => folder.root.path))
  const existing = new Set(projects.map(project => project.rootPath))
  await Promise.all([
    ...folders.filter(folder => !existing.has(folder.root.path)).map(folder =>
      request<ServerProject>("/api/v1/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rootPath: folder.root.path, name: folder.root.name }),
      }),
    ),
    ...projects.filter(project => !desired.has(project.rootPath)).map(project =>
      request<void>(`/api/v1/projects/${encodeURIComponent(project.id)}`, { method: "DELETE" }),
    ),
  ])
}
