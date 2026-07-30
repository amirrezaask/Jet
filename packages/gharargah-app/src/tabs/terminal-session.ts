export type TerminalSessionStatus = "starting" | "running" | "exited" | "failed"

export type TerminalSessionState = {
  tabId: string
  cwdRootUri: string
  launchCommand?: string
  launchArgs?: string[]
  /** Parent ADE session for a generic shell opened from its Terminal tool. */
  parentSessionTabId?: string
  ptyId?: string
  status: TerminalSessionStatus
  exitCode?: number
  signal?: number
  generation: number
  customLabel?: string
  agentId?: string
  agentDriverId?: string
  agentThreadId?: string
  /** Provider-native CLI session id used to resume after host restart. */
  agentCliSessionId?: string
  /** True after xterm has emitted user-originated input for this PTY generation. */
  hasUserInput: boolean
  /** True after output that proves launched work progressed beyond an idle shell. */
  hasMeaningfulOutput: boolean
  /** ISO timestamp of last meaningful activity (status / notify). */
  lastActivityAt: string
  /** When set, session is archived for history — not removed from roster. */
  doneAt?: string
}

const sessions = new Map<string, TerminalSessionState>()
const tabByPtyId = new Map<string, string>()
const pendingExitByPtyId = new Map<
  string,
  { exitCode: number; signal?: number }
>()
const listeners = new Set<(tabId: string) => void>()
const sessionTerminalWorkspaces = new Map<
  string,
  {
    tabIds: string[]
    activeTabId?: string
    nextOrdinal: number
  }
>()
let nextSessionTerminalId = 0

function notify(tabId: string): void {
  for (const listener of listeners) listener(tabId)
}

export function subscribeTerminalSessions(listener: (tabId: string) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function touchActivity(session: TerminalSessionState): void {
  session.lastActivityAt = new Date().toISOString()
}

export function registerTerminalSession(
  tabId: string,
  cwdRootUri: string,
  launchCommand?: string,
  options?: {
    launchArgs?: string[]
    parentSessionTabId?: string
    customLabel?: string
  },
): void {
  const existing = sessions.get(tabId)
  const now = new Date().toISOString()
  sessions.set(tabId, {
    tabId,
    cwdRootUri,
    launchCommand,
    launchArgs: options?.launchArgs ?? existing?.launchArgs,
    parentSessionTabId:
      options?.parentSessionTabId ?? existing?.parentSessionTabId,
    ptyId: existing?.ptyId,
    status: existing?.status ?? "starting",
    exitCode: existing?.exitCode,
    signal: existing?.signal,
    generation: existing?.generation ?? 0,
    customLabel: options?.customLabel ?? existing?.customLabel,
    agentId: existing?.agentId,
    agentDriverId: existing?.agentDriverId,
    agentThreadId: existing?.agentThreadId,
    agentCliSessionId: existing?.agentCliSessionId,
    hasUserInput: existing?.hasUserInput ?? false,
    hasMeaningfulOutput: existing?.hasMeaningfulOutput ?? false,
    lastActivityAt: existing?.lastActivityAt ?? now,
    doneAt: existing?.doneAt,
  })
  notify(tabId)
}

export function terminalSessionForTab(tabId: string): TerminalSessionState | undefined {
  return sessions.get(tabId)
}

export function terminalCwdForTab(tabId: string): string {
  return sessions.get(tabId)?.cwdRootUri ?? ""
}

export function terminalLaunchCommandForTab(tabId: string): string | undefined {
  return sessions.get(tabId)?.launchCommand
}

export function terminalLaunchArgsForTab(tabId: string): string[] | undefined {
  return sessions.get(tabId)?.launchArgs
}

export function trackTerminalPtyId(tabId: string, ptyId: string | null): void {
  const session = sessions.get(tabId)
  if (!session) return
  if (session.ptyId) tabByPtyId.delete(session.ptyId)
  if (ptyId) {
    session.ptyId = ptyId
    tabByPtyId.set(ptyId, tabId)
    const pendingExit = pendingExitByPtyId.get(ptyId)
    if (pendingExit) {
      pendingExitByPtyId.delete(ptyId)
      session.status = "exited"
      session.exitCode = pendingExit.exitCode
      session.signal = pendingExit.signal
    } else {
      session.status = "running"
      session.exitCode = undefined
      session.signal = undefined
    }
  } else {
    session.ptyId = undefined
  }
  touchActivity(session)
  notify(tabId)
}

export function terminalPtyIdForTab(tabId: string): string | undefined {
  return sessions.get(tabId)?.ptyId
}

/**
 * A live terminal only needs destructive-close confirmation after observable
 * use. Merely creating/attaching a PTY does not count: a fresh shell may emit a
 * prompt before the user has done anything.
 */
export function terminalSessionNeedsCloseConfirmation(
  session: TerminalSessionState | undefined,
): boolean {
  if (
    !session ||
    (session.status !== "starting" && session.status !== "running")
  ) {
    return false
  }
  return session.hasUserInput || session.hasMeaningfulOutput
}

export function recordTerminalUserInput(tabId: string): void {
  const session = sessions.get(tabId)
  if (!session || session.hasUserInput) return
  session.hasUserInput = true
  touchActivity(session)
  notify(tabId)
}

export function recordTerminalOutput(tabId: string): void {
  const session = sessions.get(tabId)
  if (!session || session.hasMeaningfulOutput) return
  // A generic shell's initial prompt is lifecycle noise. Once the user has
  // interacted, any output is meaningful; launched CLIs are meaningful as soon
  // as they produce output of their own.
  if (!session.launchCommand && !session.hasUserInput) return
  session.hasMeaningfulOutput = true
  touchActivity(session)
  notify(tabId)
}

export function setTerminalCustomLabel(tabId: string, label: string): void {
  const session = sessions.get(tabId)
  if (!session) return
  session.customLabel = label
  notify(tabId)
}

export function bindAgentToSession(
  tabId: string,
  binding: { agentId: string; driverId: string; threadId?: string },
): void {
  const session = sessions.get(tabId)
  if (!session) return
  session.agentId = binding.agentId
  session.agentDriverId = binding.driverId
  session.agentThreadId = binding.threadId
  touchActivity(session)
  notify(tabId)
}

export function agentCliSessionIdForTab(tabId: string): string | undefined {
  return sessions.get(tabId)?.agentCliSessionId
}

export function setAgentCliSessionId(tabId: string, cliSessionId: string): void {
  const session = sessions.get(tabId)
  if (!session) return
  const next = cliSessionId.trim()
  if (!next || session.agentCliSessionId === next) return
  session.agentCliSessionId = next
  touchActivity(session)
  notify(tabId)
}

export function updateTerminalLaunchArgs(tabId: string, launchArgs: string[]): void {
  const session = sessions.get(tabId)
  if (!session) return
  session.launchArgs = launchArgs
  touchActivity(session)
  notify(tabId)
}

export function sessionHasResumableAgentCli(tabId: string): boolean {
  const session = sessions.get(tabId)
  return Boolean(session?.agentCliSessionId && session.agentId)
}

export function terminalTabIdForPty(ptyId: string): string | undefined {
  return tabByPtyId.get(ptyId)
}

export function markTerminalExited(ptyId: string, exitCode: number, signal?: number): void {
  const tabId = tabByPtyId.get(ptyId)
  if (!tabId) {
    if (pendingExitByPtyId.size >= 256) {
      const oldest = pendingExitByPtyId.keys().next().value
      if (oldest) pendingExitByPtyId.delete(oldest)
    }
    pendingExitByPtyId.set(ptyId, { exitCode, signal })
    return
  }
  const session = sessions.get(tabId)
  if (!session) return
  session.status = "exited"
  session.exitCode = exitCode
  session.signal = signal
  touchActivity(session)
  notify(tabId)
}

export function markTerminalFailed(tabId: string): void {
  const session = sessions.get(tabId)
  if (!session) return
  if (session.ptyId) tabByPtyId.delete(session.ptyId)
  session.ptyId = undefined
  session.status = "failed"
  session.exitCode = undefined
  session.signal = undefined
  touchActivity(session)
  notify(tabId)
}

/** Alias for hydrate / attach-miss paths on non-resumable sessions. */
export function markTerminalUnavailable(tabId: string): void {
  if (sessionHasResumableAgentCli(tabId)) {
    markTerminalAwaitingResume(tabId)
    return
  }
  markTerminalFailed(tabId)
}

export function markTerminalAwaitingResume(tabId: string): void {
  const session = sessions.get(tabId)
  if (!session) return
  if (session.ptyId) tabByPtyId.delete(session.ptyId)
  session.ptyId = undefined
  session.status = "starting"
  session.exitCode = undefined
  session.signal = undefined
  touchActivity(session)
  notify(tabId)
}

export function restartTerminalSession(tabId: string): void {
  const session = sessions.get(tabId)
  if (!session) return
  if (session.ptyId) tabByPtyId.delete(session.ptyId)
  session.ptyId = undefined
  session.status = "starting"
  session.exitCode = undefined
  session.signal = undefined
  session.generation += 1
  session.hasUserInput = false
  session.hasMeaningfulOutput = false
  session.doneAt = undefined
  touchActivity(session)
  notify(tabId)
}

export function clearTerminalSession(tabId: string): void {
  const workspace = sessionTerminalWorkspaces.get(tabId)
  if (workspace) {
    for (const childTabId of [...workspace.tabIds]) {
      clearTerminalSession(childTabId)
    }
    sessionTerminalWorkspaces.delete(tabId)
  }
  const session = sessions.get(tabId)
  if (session?.ptyId) {
    tabByPtyId.delete(session.ptyId)
    pendingExitByPtyId.delete(session.ptyId)
  }
  sessions.delete(tabId)
  if (session?.parentSessionTabId) {
    const parentWorkspace = sessionTerminalWorkspaces.get(
      session.parentSessionTabId,
    )
    if (parentWorkspace) {
      const removedIndex = parentWorkspace.tabIds.indexOf(tabId)
      parentWorkspace.tabIds = parentWorkspace.tabIds.filter(
        candidate => candidate !== tabId,
      )
      if (parentWorkspace.activeTabId === tabId) {
        parentWorkspace.activeTabId =
          parentWorkspace.tabIds[
            Math.min(
              Math.max(0, removedIndex - 1),
              parentWorkspace.tabIds.length - 1,
            )
          ] ?? session.parentSessionTabId
      }
      notify(session.parentSessionTabId)
    }
  }
  notify(tabId)
}

export function listTerminalSessions(): TerminalSessionState[] {
  return [...sessions.values()].filter(session => !session.parentSessionTabId)
}

export function isSessionDone(tabId: string): boolean {
  return Boolean(sessions.get(tabId)?.doneAt)
}

export function markSessionDone(tabId: string): void {
  const session = sessions.get(tabId)
  if (!session || session.doneAt) return
  session.doneAt = new Date().toISOString()
  if (session.ptyId) {
    tabByPtyId.delete(session.ptyId)
    pendingExitByPtyId.delete(session.ptyId)
    session.ptyId = undefined
  }
  if (session.status === "starting" || session.status === "running") {
    session.status = "exited"
    session.exitCode = session.exitCode ?? 0
  }
  touchActivity(session)
  notify(tabId)
}

/**
 * Create a regular shell that belongs to an ADE session. These shells are kept
 * out of the Mission Control roster: they are Terminal-tool tabs, not sessions.
 */
export function addSessionTerminal(
  parentSessionTabId: string,
  options?: { minimumOrdinal?: number },
): TerminalSessionState | undefined {
  const parent = sessions.get(parentSessionTabId)
  if (!parent) return undefined
  const minimumOrdinal = Math.max(1, options?.minimumOrdinal ?? 1)
  const workspace = sessionTerminalWorkspaces.get(parentSessionTabId) ?? {
    tabIds: [],
    nextOrdinal: minimumOrdinal,
  }
  workspace.nextOrdinal = Math.max(workspace.nextOrdinal, minimumOrdinal)
  const ordinal = workspace.nextOrdinal
  workspace.nextOrdinal += 1
  nextSessionTerminalId += 1
  const tabId = `${parentSessionTabId}:shell:${Date.now().toString(36)}:${nextSessionTerminalId}`
  registerTerminalSession(tabId, parent.cwdRootUri, undefined, {
    parentSessionTabId,
    customLabel: `Terminal ${ordinal}`,
  })
  workspace.tabIds.push(tabId)
  workspace.activeTabId = tabId
  sessionTerminalWorkspaces.set(parentSessionTabId, workspace)
  notify(parentSessionTabId)
  return sessions.get(tabId)
}

export function listSessionTerminals(
  parentSessionTabId: string,
): TerminalSessionState[] {
  const workspace = sessionTerminalWorkspaces.get(parentSessionTabId)
  if (!workspace) return []
  return workspace.tabIds.flatMap(tabId => {
    const session = sessions.get(tabId)
    return session ? [session] : []
  })
}

export function activeSessionTerminalTabId(
  parentSessionTabId: string,
): string | undefined {
  return sessionTerminalWorkspaces.get(parentSessionTabId)?.activeTabId
}

export function setActiveSessionTerminal(
  parentSessionTabId: string,
  tabId: string,
): void {
  const workspace = sessionTerminalWorkspaces.get(parentSessionTabId) ?? {
    tabIds: [],
    nextOrdinal: 1,
  }
  if (
    tabId !== parentSessionTabId &&
    !workspace.tabIds.includes(tabId)
  ) {
    return
  }
  workspace.activeTabId = tabId
  sessionTerminalWorkspaces.set(parentSessionTabId, workspace)
  notify(parentSessionTabId)
}

export function removeSessionTerminal(
  parentSessionTabId: string,
  tabId: string,
): void {
  if (tabId === parentSessionTabId) return
  const session = sessions.get(tabId)
  if (session?.parentSessionTabId !== parentSessionTabId) return
  clearTerminalSession(tabId)
}

/** Includes the primary agent/terminal PTY and all Terminal-tool shell PTYs. */
export function terminalPtyIdsForSession(parentSessionTabId: string): string[] {
  const ids = [
    sessions.get(parentSessionTabId)?.ptyId,
    ...listSessionTerminals(parentSessionTabId).map(session => session.ptyId),
  ]
  return ids.filter((id): id is string => Boolean(id))
}

export type HydratedTerminalSession = {
  tabId: string
  cwdRootUri: string
  launchCommand?: string
  launchArgs?: string[]
  ptyId?: string
  status: TerminalSessionStatus
  exitCode?: number
  signal?: number
  customLabel?: string
  agentId?: string
  agentDriverId?: string
  agentThreadId?: string
  agentCliSessionId?: string
  hasUserInput?: boolean
  hasMeaningfulOutput?: boolean
  lastActivityAt?: string
  doneAt?: string
}

/** Restore session fields after a tab has been re-opened (refresh hydrate). */
export function hydrateTerminalSession(entry: HydratedTerminalSession): void {
  const existing = sessions.get(entry.tabId)
  if (existing?.ptyId) tabByPtyId.delete(existing.ptyId)
  sessions.set(entry.tabId, {
    tabId: entry.tabId,
    cwdRootUri: entry.cwdRootUri,
    launchCommand: entry.launchCommand,
    launchArgs: entry.launchArgs,
    parentSessionTabId: undefined,
    ptyId: entry.ptyId,
    status: entry.status,
    exitCode: entry.exitCode,
    signal: entry.signal,
    generation: existing?.generation ?? 0,
    customLabel: entry.customLabel,
    agentId: entry.agentId,
    agentDriverId: entry.agentDriverId,
    agentThreadId: entry.agentThreadId,
    agentCliSessionId: entry.agentCliSessionId,
    hasUserInput: entry.hasUserInput ?? false,
    hasMeaningfulOutput: entry.hasMeaningfulOutput ?? false,
    lastActivityAt:
      entry.lastActivityAt ?? existing?.lastActivityAt ?? new Date().toISOString(),
    doneAt: entry.doneAt ?? existing?.doneAt,
  })
  if (entry.ptyId) tabByPtyId.set(entry.ptyId, entry.tabId)
  notify(entry.tabId)
}

export function bumpTerminalActivity(tabId: string): void {
  const session = sessions.get(tabId)
  if (!session) return
  touchActivity(session)
  notify(tabId)
}
