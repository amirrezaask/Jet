import { Context, Effect, Layer } from "effect"
import {
  assertLegalSessionTransition,
  nextSessionStatus,
  type SessionLifecycleEvent,
  type TerminalSessionStatus,
} from "./session-machine.js"

export type TerminalSessionState = {
  tabId: string
  cwdRootUri: string
  launchCommand?: string
  launchArgs?: string[]
  /** Env injected into the PTY for ADE hook forwarders. */
  launchEnv?: Record<string, string>
  /** Parent ADE session for a generic shell opened from its Terminal tool. */
  parentSessionTabId?: string
  ptyId?: string
  status: TerminalSessionStatus
  exitCode?: number
  signal?: number
  generation: number
  customLabel?: string
  agentId?: string
  /** Stable provider/session title; terminal OSC title changes must not overwrite it. */
  agentTitle?: string
  agentDriverId?: string
  agentThreadId?: string
  /** Provider-native CLI session id used to resume after host restart. */
  agentCliSessionId?: string
  /**
   * Ephemeral: waiting for provider CLI session id before first roster write
   * (Cursor has no id until hooks fire). Not persisted. Does not block PTY.
   */
  pendingCliMint?: boolean
  /** True after xterm has emitted user-originated input for this PTY generation. */
  hasUserInput: boolean
  /** True after output that proves launched work progressed beyond an idle shell. */
  hasMeaningfulOutput: boolean
  /** ISO timestamp of last meaningful activity (status / notify). */
  lastActivityAt: string
  /** When set, session is archived for history — not removed from roster. */
  archivedAt?: string
  /** Bounded terminal output retained for archived read-only playback. */
  transcript?: string
  /** Live ring of output chunks; joined into `transcript` on archive/read. */
  transcriptParts?: string[]
  transcriptBytes?: number
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
  agentTitle?: string
  agentDriverId?: string
  agentThreadId?: string
  agentCliSessionId?: string
  hasUserInput?: boolean
  hasMeaningfulOutput?: boolean
  lastActivityAt?: string
  archivedAt?: string
  transcript?: string
  launchEnv?: Record<string, string>
}

type SessionTerminalWorkspace = {
  tabIds: string[]
  activeTabId?: string
  nextOrdinal: number
}

/** `roster` = Mission Control sidebar / persist; `local` = modal workspace only. */
export type SessionNotifyKind = "roster" | "local"

export type SessionRuntimeApi = {
  readonly subscribe: (
    listener: (tabId: string, kind: SessionNotifyKind) => void,
  ) => () => void
  readonly register: (
    tabId: string,
    cwdRootUri: string,
    launchCommand?: string,
    options?: {
      launchArgs?: string[]
      launchEnv?: Record<string, string>
      parentSessionTabId?: string
      customLabel?: string
      agentId?: string
      agentTitle?: string
      agentDriverId?: string
      agentCliSessionId?: string
      pendingCliMint?: boolean
      lastActivityAt?: string
    },
  ) => void
  readonly get: (tabId: string) => TerminalSessionState | undefined
  readonly list: () => TerminalSessionState[]
  readonly tabIdForPty: (ptyId: string) => string | undefined
  readonly trackPty: (tabId: string, ptyId: string | null) => void
  readonly markExited: (ptyId: string, exitCode: number, signal?: number) => void
  readonly markFailed: (tabId: string) => void
  readonly markAwaitingResume: (tabId: string) => void
  readonly restart: (tabId: string) => void
  readonly resumeArchived: (tabId: string) => void
  readonly archive: (tabId: string) => void
  readonly clear: (tabId: string) => void
  readonly hydrate: (entry: HydratedTerminalSession) => void
  readonly recordUserInput: (tabId: string) => void
  readonly recordOutput: (tabId: string, chunk?: string) => void
  readonly setCustomLabel: (tabId: string, label: string) => void
  readonly setAgentTitle: (tabId: string, title: string) => void
  readonly bindAgent: (
    tabId: string,
    binding: { agentId: string; driverId: string; threadId?: string },
  ) => void
  readonly setAgentCliSessionId: (tabId: string, cliSessionId: string) => void
  readonly setPendingCliMint: (tabId: string, pending: boolean) => void
  readonly updateLaunchArgs: (tabId: string, launchArgs: string[]) => void
  readonly bumpActivity: (tabId: string) => void
  readonly addSessionTerminal: (
    parentSessionTabId: string,
    options?: { minimumOrdinal?: number },
  ) => TerminalSessionState | undefined
  readonly listSessionTerminals: (parentSessionTabId: string) => TerminalSessionState[]
  readonly activeSessionTerminalTabId: (parentSessionTabId: string) => string | undefined
  readonly setActiveSessionTerminal: (parentSessionTabId: string, tabId: string) => void
  readonly removeSessionTerminal: (parentSessionTabId: string, tabId: string) => void
  readonly ptyIdsForSession: (parentSessionTabId: string) => string[]
  readonly applyStatusEvent: (tabId: string, event: SessionLifecycleEvent) => void
}

export function createSessionStore(): SessionRuntimeApi {
  const maxTranscriptChars = 262_144
  const sessions = new Map<string, TerminalSessionState>()
  const tabByPtyId = new Map<string, string>()
  const pendingExitByPtyId = new Map<string, { exitCode: number; signal?: number }>()
  const retiredPtyIds = new Set<string>()
  const listeners = new Set<(tabId: string, kind: SessionNotifyKind) => void>()
  const sessionTerminalWorkspaces = new Map<string, SessionTerminalWorkspace>()
  let nextSessionTerminalId = 0

  function notify(tabId: string, kind?: SessionNotifyKind): void {
    const session = sessions.get(tabId)
    const resolved: SessionNotifyKind =
      kind ?? (session?.parentSessionTabId ? "local" : "roster")
    for (const listener of listeners) listener(tabId, resolved)
  }

  function touchActivity(session: TerminalSessionState): void {
    session.lastActivityAt = new Date().toISOString()
  }

  function clearTranscript(session: TerminalSessionState): void {
    session.transcript = undefined
    session.transcriptParts = undefined
    session.transcriptBytes = undefined
  }

  function materializeTranscript(session: TerminalSessionState): string | undefined {
    if (session.transcript != null) return session.transcript
    const parts = session.transcriptParts
    if (!parts || parts.length === 0) return undefined
    session.transcript = parts.join("")
    session.transcriptParts = undefined
    session.transcriptBytes = undefined
    return session.transcript
  }

  function applyStatus(session: TerminalSessionState, event: SessionLifecycleEvent): void {
    assertLegalSessionTransition(session.tabId, session.status, event)
    session.status = nextSessionStatus(session.status, event)
  }

  function retirePty(session: TerminalSessionState): void {
    const ptyId = session.ptyId
    if (!ptyId) return
    tabByPtyId.delete(ptyId)
    pendingExitByPtyId.delete(ptyId)
    retiredPtyIds.add(ptyId)
    if (retiredPtyIds.size > 256) {
      const oldest = retiredPtyIds.values().next().value
      if (oldest) retiredPtyIds.delete(oldest)
    }
    session.ptyId = undefined
  }

  const api: SessionRuntimeApi = {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    register(tabId, cwdRootUri, launchCommand, options) {
      const existing = sessions.get(tabId)
      const now = new Date().toISOString()
      sessions.set(tabId, {
        tabId,
        cwdRootUri,
        launchCommand,
        launchArgs: options?.launchArgs ?? existing?.launchArgs,
        launchEnv: options?.launchEnv ?? existing?.launchEnv,
        parentSessionTabId:
          options?.parentSessionTabId ?? existing?.parentSessionTabId,
        ptyId: existing?.ptyId,
        status: existing?.status ?? "starting",
        exitCode: existing?.exitCode,
        signal: existing?.signal,
        generation: existing?.generation ?? 0,
        customLabel: options?.customLabel ?? existing?.customLabel,
        agentId: options?.agentId ?? existing?.agentId,
        agentTitle: options?.agentTitle ?? existing?.agentTitle,
        agentDriverId: options?.agentDriverId ?? existing?.agentDriverId,
        agentThreadId: existing?.agentThreadId,
        agentCliSessionId:
          options?.agentCliSessionId?.trim() || existing?.agentCliSessionId,
        pendingCliMint: options?.pendingCliMint ?? existing?.pendingCliMint,
        hasUserInput: existing?.hasUserInput ?? false,
        hasMeaningfulOutput: existing?.hasMeaningfulOutput ?? false,
        lastActivityAt: options?.lastActivityAt ?? existing?.lastActivityAt ?? now,
        archivedAt: existing?.archivedAt,
        transcript: existing?.transcript,
      })
      notify(tabId)
    },

    get(tabId) {
      return sessions.get(tabId)
    },

    list() {
      return [...sessions.values()].filter(session => !session.parentSessionTabId)
    },

    tabIdForPty(ptyId) {
      return tabByPtyId.get(ptyId)
    },

    trackPty(tabId, ptyId) {
      const session = sessions.get(tabId)
      if (!session) return
      if (session.ptyId) tabByPtyId.delete(session.ptyId)
      if (ptyId) {
        retiredPtyIds.delete(ptyId)
        session.ptyId = ptyId
        tabByPtyId.set(ptyId, tabId)
        const pendingExit = pendingExitByPtyId.get(ptyId)
        if (pendingExit) {
          pendingExitByPtyId.delete(ptyId)
          applyStatus(session, { _tag: "PtyBound", pendingExit })
          session.exitCode = pendingExit.exitCode
          session.signal = pendingExit.signal
        } else {
          applyStatus(session, { _tag: "PtyBound" })
          session.exitCode = undefined
          session.signal = undefined
        }
      } else {
        applyStatus(session, { _tag: "PtyUnbound" })
        session.ptyId = undefined
      }
      touchActivity(session)
      notify(tabId)
    },

    markExited(ptyId, exitCode, signal) {
      if (retiredPtyIds.delete(ptyId)) return
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
      applyStatus(session, { _tag: "ProcessExited", exitCode, signal })
      session.exitCode = exitCode
      session.signal = signal
      touchActivity(session)
      notify(tabId)
    },

    markFailed(tabId) {
      const session = sessions.get(tabId)
      if (!session) return
      retirePty(session)
      applyStatus(session, { _tag: "Failed" })
      session.exitCode = undefined
      session.signal = undefined
      touchActivity(session)
      notify(tabId)
    },

    markAwaitingResume(tabId) {
      const session = sessions.get(tabId)
      if (!session) return
      retirePty(session)
      applyStatus(session, { _tag: "AwaitResume" })
      session.exitCode = undefined
      session.signal = undefined
      // Bump so keepMounted TerminalPanel remounts and respawns / resumes.
      session.generation += 1
      touchActivity(session)
      notify(tabId)
    },

    restart(tabId) {
      const session = sessions.get(tabId)
      if (!session) return
      retirePty(session)
      applyStatus(session, { _tag: "Restart" })
      session.exitCode = undefined
      session.signal = undefined
      session.generation += 1
      session.hasUserInput = false
      session.hasMeaningfulOutput = false
      session.archivedAt = undefined
      clearTranscript(session)
      touchActivity(session)
      notify(tabId)
    },

    resumeArchived(tabId) {
      const session = sessions.get(tabId)
      if (!session?.archivedAt) return
      retirePty(session)
      applyStatus(session, { _tag: "ResumeArchived" })
      session.exitCode = undefined
      session.signal = undefined
      session.generation += 1
      session.hasUserInput = false
      session.hasMeaningfulOutput = false
      session.archivedAt = undefined
      clearTranscript(session)
      touchActivity(session)
      notify(tabId)
    },

    archive(tabId) {
      const session = sessions.get(tabId)
      if (!session || session.archivedAt) return
      session.archivedAt = new Date().toISOString()
      materializeTranscript(session)
      retirePty(session)
      applyStatus(session, { _tag: "Archive" })
      if (session.status === "exited") {
        session.exitCode = session.exitCode ?? 0
      }
      touchActivity(session)
      notify(tabId)
    },

    clear(tabId) {
      const workspace = sessionTerminalWorkspaces.get(tabId)
      if (workspace) {
        for (const childTabId of [...workspace.tabIds]) {
          api.clear(childTabId)
        }
        sessionTerminalWorkspaces.delete(tabId)
      }
      const session = sessions.get(tabId)
      if (session) retirePty(session)
      sessions.delete(tabId)
      if (session?.parentSessionTabId) {
        const parentWorkspace = sessionTerminalWorkspaces.get(session.parentSessionTabId)
        if (parentWorkspace) {
          const removedIndex = parentWorkspace.tabIds.indexOf(tabId)
          parentWorkspace.tabIds = parentWorkspace.tabIds.filter(candidate => candidate !== tabId)
          if (parentWorkspace.activeTabId === tabId) {
            parentWorkspace.activeTabId =
              parentWorkspace.tabIds[
                Math.min(Math.max(0, removedIndex - 1), parentWorkspace.tabIds.length - 1)
              ] ?? session.parentSessionTabId
          }
          notify(session.parentSessionTabId, "local")
        }
      }
      notify(tabId)
    },

    hydrate(entry) {
      const existing = sessions.get(entry.tabId)
      if (existing) retirePty(existing)
      if (existing) {
        assertLegalSessionTransition(entry.tabId, existing.status, {
          _tag: "Hydrate",
          status: entry.status,
        })
      }
      const status = nextSessionStatus(existing?.status ?? "starting", {
        _tag: "Hydrate",
        status: entry.status,
      })
      sessions.set(entry.tabId, {
        tabId: entry.tabId,
        cwdRootUri: entry.cwdRootUri,
        launchCommand: entry.launchCommand,
        launchArgs: entry.launchArgs,
        launchEnv: entry.launchEnv,
        parentSessionTabId: undefined,
        ptyId: entry.ptyId,
        status,
        exitCode: entry.exitCode,
        signal: entry.signal,
        generation: existing?.generation ?? 0,
        customLabel: entry.customLabel,
        agentId: entry.agentId,
        agentTitle: entry.agentTitle,
        agentDriverId: entry.agentDriverId,
        agentThreadId: entry.agentThreadId,
        agentCliSessionId: entry.agentCliSessionId,
        hasUserInput: entry.hasUserInput ?? false,
        hasMeaningfulOutput: entry.hasMeaningfulOutput ?? false,
        lastActivityAt:
          entry.lastActivityAt ?? existing?.lastActivityAt ?? new Date().toISOString(),
        archivedAt: entry.archivedAt ?? existing?.archivedAt,
        transcript: entry.transcript ?? existing?.transcript,
      })
      if (entry.ptyId) tabByPtyId.set(entry.ptyId, entry.tabId)
      notify(entry.tabId)
    },

    recordUserInput(tabId) {
      const session = sessions.get(tabId)
      if (!session || session.hasUserInput) return
      session.hasUserInput = true
      touchActivity(session)
      notify(tabId)
    },

    recordOutput(tabId, chunk) {
      const session = sessions.get(tabId)
      if (!session) return
      if (chunk) {
        // Chunk ring — avoid O(n²) string rebuild on every PTY frame while
        // Cursor Agent floods output (was a main-thread typing killer).
        const parts = session.transcriptParts ?? []
        parts.push(chunk)
        let bytes = (session.transcriptBytes ?? 0) + chunk.length
        while (bytes > maxTranscriptChars && parts.length > 1) {
          bytes -= parts.shift()!.length
        }
        if (bytes > maxTranscriptChars && parts.length === 1) {
          const only = parts[0]!
          parts[0] = only.slice(only.length - maxTranscriptChars)
          bytes = parts[0]!.length
        }
        session.transcriptParts = parts
        session.transcriptBytes = bytes
        session.transcript = undefined
      }
      if (session.hasMeaningfulOutput) return
      if (!session.launchCommand && !session.hasUserInput) return
      session.hasMeaningfulOutput = true
      touchActivity(session)
      notify(tabId)
    },

    setCustomLabel(tabId, label) {
      const session = sessions.get(tabId)
      if (!session) return
      session.customLabel = label
      notify(tabId)
    },

    setAgentTitle(tabId, title) {
      const session = sessions.get(tabId)
      if (!session) return
      const next = title.trim()
      if (!next || session.agentTitle === next) return
      session.agentTitle = next
      touchActivity(session)
      notify(tabId)
    },

    bindAgent(tabId, binding) {
      const session = sessions.get(tabId)
      if (!session) return
      session.agentId = binding.agentId
      session.agentDriverId = binding.driverId
      session.agentThreadId = binding.threadId
      touchActivity(session)
      notify(tabId)
    },

    setAgentCliSessionId(tabId, cliSessionId) {
      const session = sessions.get(tabId)
      if (!session) return
      const next = cliSessionId.trim()
      if (!next || session.agentCliSessionId === next) return
      session.agentCliSessionId = next
      // CLI id ready — allow roster persist (Cursor deferred until this point).
      session.pendingCliMint = undefined
      touchActivity(session)
      notify(tabId)
    },

    setPendingCliMint(tabId, pending) {
      const session = sessions.get(tabId)
      if (!session) return
      const next = Boolean(pending)
      if (session.pendingCliMint === next) return
      session.pendingCliMint = next || undefined
      notify(tabId)
    },

    updateLaunchArgs(tabId, launchArgs) {
      const session = sessions.get(tabId)
      if (!session) return
      session.launchArgs = launchArgs
      touchActivity(session)
      notify(tabId)
    },

    bumpActivity(tabId) {
      const session = sessions.get(tabId)
      if (!session) return
      touchActivity(session)
      notify(tabId)
    },

    addSessionTerminal(parentSessionTabId, options) {
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
      api.register(tabId, parent.cwdRootUri, undefined, {
        parentSessionTabId,
        customLabel: `Terminal ${ordinal}`,
      })
      workspace.tabIds.push(tabId)
      workspace.activeTabId = tabId
      sessionTerminalWorkspaces.set(parentSessionTabId, workspace)
      notify(parentSessionTabId, "local")
      return sessions.get(tabId)
    },

    listSessionTerminals(parentSessionTabId) {
      const workspace = sessionTerminalWorkspaces.get(parentSessionTabId)
      if (!workspace) return []
      return workspace.tabIds.flatMap(tabId => {
        const session = sessions.get(tabId)
        return session ? [session] : []
      })
    },

    activeSessionTerminalTabId(parentSessionTabId) {
      return sessionTerminalWorkspaces.get(parentSessionTabId)?.activeTabId
    },

    setActiveSessionTerminal(parentSessionTabId, tabId) {
      const workspace = sessionTerminalWorkspaces.get(parentSessionTabId) ?? {
        tabIds: [],
        nextOrdinal: 1,
      }
      if (tabId !== parentSessionTabId && !workspace.tabIds.includes(tabId)) {
        return
      }
      workspace.activeTabId = tabId
      sessionTerminalWorkspaces.set(parentSessionTabId, workspace)
      notify(parentSessionTabId, "local")
    },

    removeSessionTerminal(parentSessionTabId, tabId) {
      if (tabId === parentSessionTabId) return
      const session = sessions.get(tabId)
      if (session?.parentSessionTabId !== parentSessionTabId) return
      api.clear(tabId)
    },

    ptyIdsForSession(parentSessionTabId) {
      const ids = [
        sessions.get(parentSessionTabId)?.ptyId,
        ...api.listSessionTerminals(parentSessionTabId).map(session => session.ptyId),
      ]
      return ids.filter((id): id is string => Boolean(id))
    },

    applyStatusEvent(tabId, event) {
      const session = sessions.get(tabId)
      if (!session) return
      applyStatus(session, event)
      touchActivity(session)
      notify(tabId)
    },
  }

  return api
}

/** Process-wide session store (browser ADE). Sync shims + Effect Tag share this. */
export const defaultSessionStore: SessionRuntimeApi = createSessionStore()

export class SessionRuntime extends Context.Tag("gharargah/SessionRuntime")<
  SessionRuntime,
  SessionRuntimeApi
>() {}

export const SessionRuntimeLive: Layer.Layer<SessionRuntime> = Layer.succeed(
  SessionRuntime,
  defaultSessionStore,
)

export function runSession<A>(effect: Effect.Effect<A, never, SessionRuntime>): A {
  return Effect.runSync(effect.pipe(Effect.provide(SessionRuntimeLive)))
}
