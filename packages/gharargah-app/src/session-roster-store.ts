import type { TerminalSessionStatus } from "./tabs/terminal-session.js"

export const SESSION_ROSTER_STORAGE_KEY = "jet-session-roster-v1"

export type PersistedSessionMode = "terminal" | "editor" | "git" | "todos"

export type PersistedSessionEntry = {
  tabId: string
  cwdRootUri: string
  label: string
  launchCommand?: string
  ptyId?: string
  status: TerminalSessionStatus
  exitCode?: number
  customLabel?: string
}

export type PersistedSessionModal = {
  tabId: string
  sessionMode: PersistedSessionMode
}

export type PersistedSessionRoster = {
  version: 1
  sessions: PersistedSessionEntry[]
  modal: PersistedSessionModal | null
}

const EMPTY_ROSTER: PersistedSessionRoster = {
  version: 1,
  sessions: [],
  modal: null,
}

const SESSION_STATUSES = new Set<TerminalSessionStatus>([
  "starting",
  "running",
  "exited",
  "failed",
])

const SESSION_MODES = new Set<PersistedSessionMode>([
  "terminal",
  "editor",
  "git",
  "todos",
])

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null
}

function asStatus(value: unknown): TerminalSessionStatus | null {
  return typeof value === "string" && SESSION_STATUSES.has(value as TerminalSessionStatus)
    ? (value as TerminalSessionStatus)
    : null
}

function asSessionMode(value: unknown): PersistedSessionMode | null {
  return typeof value === "string" && SESSION_MODES.has(value as PersistedSessionMode)
    ? (value as PersistedSessionMode)
    : null
}

function parseEntry(raw: unknown): PersistedSessionEntry | null {
  if (!raw || typeof raw !== "object") return null
  const item = raw as Partial<PersistedSessionEntry>
  const tabId = asNonEmptyString(item.tabId)
  const cwdRootUri = asNonEmptyString(item.cwdRootUri)
  const label = asNonEmptyString(item.label) ?? "Terminal"
  const status = asStatus(item.status) ?? "starting"
  if (!tabId || !cwdRootUri) return null
  const entry: PersistedSessionEntry = {
    tabId,
    cwdRootUri,
    label,
    status,
  }
  const launchCommand = asNonEmptyString(item.launchCommand)
  if (launchCommand) entry.launchCommand = launchCommand
  const ptyId = asNonEmptyString(item.ptyId)
  if (ptyId) entry.ptyId = ptyId
  const customLabel = asNonEmptyString(item.customLabel)
  if (customLabel) entry.customLabel = customLabel
  if (typeof item.exitCode === "number" && Number.isFinite(item.exitCode)) {
    entry.exitCode = item.exitCode
  }
  return entry
}

function parseModal(raw: unknown): PersistedSessionModal | null {
  if (!raw || typeof raw !== "object") return null
  const item = raw as Partial<PersistedSessionModal>
  const tabId = asNonEmptyString(item.tabId)
  const sessionMode = asSessionMode(item.sessionMode)
  if (!tabId || !sessionMode) return null
  return { tabId, sessionMode }
}

export function readSessionRoster(
  storage: Pick<Storage, "getItem"> = localStorage,
): PersistedSessionRoster {
  try {
    const raw = storage.getItem(SESSION_ROSTER_STORAGE_KEY)
    if (!raw) return EMPTY_ROSTER
    const parsed = JSON.parse(raw) as Partial<PersistedSessionRoster>
    if (parsed.version !== 1 || !Array.isArray(parsed.sessions)) return EMPTY_ROSTER
    const seen = new Set<string>()
    const sessions: PersistedSessionEntry[] = []
    for (const item of parsed.sessions) {
      const entry = parseEntry(item)
      if (!entry || seen.has(entry.tabId)) continue
      seen.add(entry.tabId)
      sessions.push(entry)
    }
    const modal = parseModal(parsed.modal)
    return {
      version: 1,
      sessions,
      modal: modal && seen.has(modal.tabId) ? modal : null,
    }
  } catch {
    return EMPTY_ROSTER
  }
}

export function writeSessionRoster(
  roster: PersistedSessionRoster,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  try {
    storage.setItem(SESSION_ROSTER_STORAGE_KEY, JSON.stringify(roster))
  } catch {
    /* localStorage may be disabled; in-memory sessions still work. */
  }
}
