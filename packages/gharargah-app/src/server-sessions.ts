import {
  LEGACY_SESSION_ROSTER_STORAGE_KEY,
  readSessionRoster,
  SESSION_ROSTER_STORAGE_KEY,
  type PersistedSessionRoster,
} from "./session-roster-store.js"

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  if (!response.ok) throw new Error(`Jet session API failed (${response.status})`)
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export async function loadServerSessionRoster(): Promise<PersistedSessionRoster> {
  return request<PersistedSessionRoster>("/api/v1/sessions")
}

export async function saveServerSessionRoster(
  roster: PersistedSessionRoster,
): Promise<PersistedSessionRoster> {
  return request<PersistedSessionRoster>("/api/v1/sessions", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(roster),
    keepalive: true,
  })
}

/**
 * One-shot: push leftover localStorage roster into SQLite when server empty,
 * then delete both roster keys. Safe every boot — no-op when keys absent.
 */
export async function migrateLegacyLocalSessionRoster(
  storage: Pick<Storage, "getItem" | "removeItem"> = localStorage,
): Promise<void> {
  let hasLocal = false
  try {
    hasLocal = Boolean(
      storage.getItem(SESSION_ROSTER_STORAGE_KEY) ??
        storage.getItem(LEGACY_SESSION_ROSTER_STORAGE_KEY),
    )
  } catch {
    return
  }
  if (!hasLocal) return

  try {
    const server = await loadServerSessionRoster()
    if (server.sessions.length === 0) {
      const local = readSessionRoster(storage)
      if (local.sessions.length > 0) {
        await saveServerSessionRoster(local)
      }
    }
  } catch {
    /* host may be down — leave local keys for a later boot */
    return
  }

  try {
    storage.removeItem(SESSION_ROSTER_STORAGE_KEY)
    storage.removeItem(LEGACY_SESSION_ROSTER_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}
