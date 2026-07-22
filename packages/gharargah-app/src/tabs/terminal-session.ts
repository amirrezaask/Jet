export type TerminalSessionStatus = "starting" | "running" | "exited" | "failed"

export type TerminalSessionState = {
  tabId: string
  cwdRootUri: string
  launchCommand?: string
  ptyId?: string
  status: TerminalSessionStatus
  exitCode?: number
  signal?: number
  generation: number
  customLabel?: string
  agentId?: string
  agentDriverId?: string
  agentThreadId?: string
}

const sessions = new Map<string, TerminalSessionState>()
const tabByPtyId = new Map<string, string>()
const listeners = new Set<(tabId: string) => void>()

function notify(tabId: string): void {
  for (const listener of listeners) listener(tabId)
}

export function subscribeTerminalSessions(listener: (tabId: string) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function registerTerminalSession(
  tabId: string,
  cwdRootUri: string,
  launchCommand?: string,
): void {
  const existing = sessions.get(tabId)
  sessions.set(tabId, {
    tabId,
    cwdRootUri,
    launchCommand,
    ptyId: existing?.ptyId,
    status: existing?.status ?? "starting",
    exitCode: existing?.exitCode,
    signal: existing?.signal,
    generation: existing?.generation ?? 0,
    customLabel: existing?.customLabel,
    agentId: existing?.agentId,
    agentDriverId: existing?.agentDriverId,
    agentThreadId: existing?.agentThreadId,
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

export function trackTerminalPtyId(tabId: string, ptyId: string | null): void {
  const session = sessions.get(tabId)
  if (!session) return
  if (session.ptyId) tabByPtyId.delete(session.ptyId)
  if (ptyId) {
    session.ptyId = ptyId
    session.status = "running"
    session.exitCode = undefined
    session.signal = undefined
    tabByPtyId.set(ptyId, tabId)
  } else {
    session.ptyId = undefined
  }
  notify(tabId)
}

export function terminalPtyIdForTab(tabId: string): string | undefined {
  return sessions.get(tabId)?.ptyId
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
  notify(tabId)
}

export function terminalTabIdForPty(ptyId: string): string | undefined {
  return tabByPtyId.get(ptyId)
}

export function markTerminalExited(ptyId: string, exitCode: number, signal?: number): void {
  const tabId = tabByPtyId.get(ptyId)
  if (!tabId) return
  const session = sessions.get(tabId)
  if (!session) return
  session.status = "exited"
  session.exitCode = exitCode
  session.signal = signal
  notify(tabId)
}

export function markTerminalFailed(tabId: string): void {
  const session = sessions.get(tabId)
  if (!session) return
  session.status = "failed"
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
  notify(tabId)
}

export function clearTerminalSession(tabId: string): void {
  const session = sessions.get(tabId)
  if (session?.ptyId) tabByPtyId.delete(session.ptyId)
  sessions.delete(tabId)
  notify(tabId)
}

export function listTerminalSessions(): TerminalSessionState[] {
  return [...sessions.values()]
}

export type HydratedTerminalSession = {
  tabId: string
  cwdRootUri: string
  launchCommand?: string
  ptyId?: string
  status: TerminalSessionStatus
  exitCode?: number
  signal?: number
  customLabel?: string
  agentId?: string
  agentDriverId?: string
  agentThreadId?: string
}

/** Restore session fields after a tab has been re-opened (refresh hydrate). */
export function hydrateTerminalSession(entry: HydratedTerminalSession): void {
  const existing = sessions.get(entry.tabId)
  if (existing?.ptyId) tabByPtyId.delete(existing.ptyId)
  sessions.set(entry.tabId, {
    tabId: entry.tabId,
    cwdRootUri: entry.cwdRootUri,
    launchCommand: entry.launchCommand,
    ptyId: entry.ptyId,
    status: entry.status,
    exitCode: entry.exitCode,
    signal: entry.signal,
    generation: existing?.generation ?? 0,
    customLabel: entry.customLabel,
    agentId: entry.agentId,
    agentDriverId: entry.agentDriverId,
    agentThreadId: entry.agentThreadId,
  })
  if (entry.ptyId) tabByPtyId.set(entry.ptyId, entry.tabId)
  notify(entry.tabId)
}
