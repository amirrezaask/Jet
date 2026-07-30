import {
  decodeSessionRosterUnknown,
  type SessionRoster,
  type SessionRosterEntry,
  type SessionRosterModal,
  type SessionRosterMode,
  type TerminalSessionStatus,
} from "@gharargah/rpc"

export type { TerminalSessionStatus }

export const SESSION_ROSTER_STORAGE_KEY = "gharargah-session-roster-v2"
export const LEGACY_SESSION_ROSTER_STORAGE_KEY = "jet-session-roster-v1"

export type PersistedSessionMode = SessionRosterMode
export type PersistedSessionEntry = SessionRosterEntry
export type PersistedSessionModal = SessionRosterModal
export type PersistedSessionRoster = SessionRoster

export function readSessionRoster(
  storage: Pick<Storage, "getItem"> = localStorage,
): PersistedSessionRoster {
  try {
    const raw =
      storage.getItem(SESSION_ROSTER_STORAGE_KEY) ??
      storage.getItem(LEGACY_SESSION_ROSTER_STORAGE_KEY)
    if (!raw) {
      return decodeSessionRosterUnknown(null)
    }
    return decodeSessionRosterUnknown(JSON.parse(raw) as unknown)
  } catch {
    return decodeSessionRosterUnknown(null)
  }
}

export function writeSessionRoster(
  roster: PersistedSessionRoster,
  storage?: Pick<Storage, "setItem">,
): void {
  const store =
    storage ??
    (typeof localStorage !== "undefined"
      ? localStorage
      : ({ setItem() {} } as Pick<Storage, "setItem">))
  try {
    store.setItem(SESSION_ROSTER_STORAGE_KEY, JSON.stringify(roster))
  } catch {
    /* localStorage may be disabled; in-memory sessions still work. */
  }
}
