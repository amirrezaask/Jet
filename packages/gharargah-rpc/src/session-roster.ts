import { Schema } from "effect"

const MAX_LAUNCH_ARG_LEN = 32_768

/** Canonical ADE session PTY lifecycle status (persisted in roster). */
export const TerminalSessionStatus = Schema.Literal("starting", "running", "exited", "failed")
export type TerminalSessionStatus = Schema.Schema.Type<typeof TerminalSessionStatus>

export const SessionRosterMode = Schema.Literal("agent", "terminal", "editor", "git", "todos")
export type SessionRosterMode = Schema.Schema.Type<typeof SessionRosterMode>

export const SessionRosterEntry = Schema.Struct({
  tabId: Schema.String,
  cwdRootUri: Schema.String,
  label: Schema.String,
  status: TerminalSessionStatus,
  launchCommand: Schema.optional(Schema.String),
  launchArgs: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  ptyId: Schema.optional(Schema.String),
  exitCode: Schema.optional(Schema.Number),
  customLabel: Schema.optional(Schema.String),
  agentId: Schema.optional(Schema.String),
  agentDriverId: Schema.optional(Schema.String),
  agentThreadId: Schema.optional(Schema.String),
  agentCliSessionId: Schema.optional(Schema.String),
  hasUserInput: Schema.optional(Schema.Boolean),
  hasMeaningfulOutput: Schema.optional(Schema.Boolean),
  lastActivityAt: Schema.optional(Schema.String),
  doneAt: Schema.optional(Schema.String),
})
export type SessionRosterEntry = Schema.Schema.Type<typeof SessionRosterEntry>

export const SessionRosterModal = Schema.Struct({
  tabId: Schema.String,
  sessionMode: SessionRosterMode,
})
export type SessionRosterModal = Schema.Schema.Type<typeof SessionRosterModal>

export const SessionRoster = Schema.Struct({
  version: Schema.Literal(2),
  sessions: Schema.Array(SessionRosterEntry),
  modal: Schema.NullOr(SessionRosterModal),
})
export type SessionRoster = Schema.Schema.Type<typeof SessionRoster>

/** @deprecated Use SessionRoster — kept for import stability during migration. */
export const SessionRosterV2 = SessionRoster
export type SessionRosterV2 = SessionRoster

export const EMPTY_SESSION_ROSTER: SessionRoster = {
  version: 2,
  sessions: [],
  modal: null,
}

export const encodeSessionRoster = Schema.encode(SessionRoster)

const SESSION_STATUSES = new Set<TerminalSessionStatus>([
  "starting",
  "running",
  "exited",
  "failed",
])

const SESSION_MODES = new Set<SessionRosterMode>([
  "terminal",
  "agent",
  "editor",
  "git",
  "todos",
])

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null
}

function asStatus(value: unknown): TerminalSessionStatus | null {
  if (value === "interrupted") return "failed"
  return typeof value === "string" && SESSION_STATUSES.has(value as TerminalSessionStatus)
    ? (value as TerminalSessionStatus)
    : null
}

function asSessionMode(value: unknown): SessionRosterMode | null {
  return typeof value === "string" && SESSION_MODES.has(value as SessionRosterMode)
    ? (value as SessionRosterMode)
    : null
}

function parseEntry(raw: unknown): SessionRosterEntry | null {
  if (!raw || typeof raw !== "object") return null
  const item = raw as Record<string, unknown>
  const tabId = asNonEmptyString(item.tabId)
  const cwdRootUri = asNonEmptyString(item.cwdRootUri)
  const label = asNonEmptyString(item.label) ?? "Terminal"
  const status = asStatus(item.status) ?? "starting"
  if (!tabId || !cwdRootUri) return null

  const launchCommand = asNonEmptyString(item.launchCommand) ?? undefined
  const agentId = asNonEmptyString(item.agentId) ?? undefined
  const agentDriverId = asNonEmptyString(item.agentDriverId) ?? undefined
  // Native-driver sessions run in-app and legitimately have no launch command;
  // a CLI agent without one is an incomplete stub. Blank shells are OK.
  if (agentId && !launchCommand && (!agentDriverId || agentDriverId.endsWith(":cli"))) {
    return null
  }

  let launchArgs: string[] | undefined
  if (Array.isArray(item.launchArgs)) {
    const filtered = item.launchArgs.filter(
      (arg): arg is string => typeof arg === "string" && arg.length <= MAX_LAUNCH_ARG_LEN,
    )
    if (filtered.length > 0) launchArgs = filtered
  }

  const exitCode =
    typeof item.exitCode === "number" && Number.isFinite(item.exitCode)
      ? item.exitCode
      : undefined

  return {
    tabId,
    cwdRootUri,
    label,
    status,
    ...(launchCommand ? { launchCommand } : {}),
    ...(launchArgs ? { launchArgs } : {}),
    ...(asNonEmptyString(item.ptyId) ? { ptyId: asNonEmptyString(item.ptyId)! } : {}),
    ...(asNonEmptyString(item.customLabel)
      ? { customLabel: asNonEmptyString(item.customLabel)! }
      : {}),
    ...(exitCode !== undefined ? { exitCode } : {}),
    ...(agentId ? { agentId } : {}),
    ...(agentDriverId ? { agentDriverId } : {}),
    ...(asNonEmptyString(item.agentThreadId)
      ? { agentThreadId: asNonEmptyString(item.agentThreadId)! }
      : {}),
    ...(asNonEmptyString(item.agentCliSessionId)
      ? { agentCliSessionId: asNonEmptyString(item.agentCliSessionId)! }
      : {}),
    ...(item.hasUserInput === true ? { hasUserInput: true } : {}),
    ...(item.hasMeaningfulOutput === true ? { hasMeaningfulOutput: true } : {}),
    ...(asNonEmptyString(item.lastActivityAt)
      ? { lastActivityAt: asNonEmptyString(item.lastActivityAt)! }
      : {}),
    ...(asNonEmptyString(item.doneAt) ? { doneAt: asNonEmptyString(item.doneAt)! } : {}),
  }
}

function parseModal(raw: unknown): SessionRosterModal | null {
  if (!raw || typeof raw !== "object") return null
  const item = raw as Record<string, unknown>
  const tabId = asNonEmptyString(item.tabId)
  const sessionMode = asSessionMode(item.sessionMode)
  if (!tabId || !sessionMode) return null
  return { tabId, sessionMode }
}

/**
 * Validate + normalize a roster payload.
 * Returns `null` when structurally invalid (wrong version / missing sessions array).
 * Used by host `PUT /api/v1/sessions` (HTTP 400 on null).
 */
export function tryDecodeSessionRoster(raw: unknown): SessionRoster | null {
  if (!raw || typeof raw !== "object") return null
  const body = raw as { version?: unknown; sessions?: unknown; modal?: unknown }
  if (body.version !== 1 && body.version !== 2) return null
  if (!Array.isArray(body.sessions)) return null
  const seen = new Set<string>()
  const sessions: SessionRosterEntry[] = []
  for (const item of body.sessions) {
    const entry = parseEntry(item)
    if (!entry || seen.has(entry.tabId)) continue
    seen.add(entry.tabId)
    sessions.push(entry)
  }
  const modal = parseModal(body.modal)
  return {
    version: 2,
    sessions,
    modal: modal && seen.has(modal.tabId) ? modal : null,
  }
}

/**
 * Compat decode for untrusted / persisted data (localStorage).
 * Corrupt or structurally invalid input → empty roster (never throws).
 */
export function decodeSessionRosterUnknown(raw: unknown): SessionRoster {
  return tryDecodeSessionRoster(raw) ?? EMPTY_SESSION_ROSTER
}
