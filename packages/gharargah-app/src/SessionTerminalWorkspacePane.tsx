import {
  lazy,
  Suspense,
  useEffect,
  useReducer,
  type ReactNode,
} from "react"
import type { GharargahTheme } from "@gharargah/shared"
import {
  requestConfirm,
  SessionTerminalWorkspace,
  type SessionTerminalItem,
} from "@gharargah/ui"
import {
  activeSessionTerminalTabId,
  addSessionTerminal,
  listSessionTerminals,
  markTerminalFailed,
  recordTerminalOutput,
  recordTerminalUserInput,
  removeSessionTerminal,
  restartTerminalSession,
  setActiveSessionTerminal,
  subscribeTerminalSessions,
  terminalPtyIdForTab,
  terminalSessionForTab,
  terminalSessionNeedsCloseConfirmation,
  trackTerminalPtyId,
} from "./tabs/terminal-session.js"
import { applyAgentCliResumeLaunchArgs } from "./agent-cli-resume.js"

const TerminalPanel = lazy(async () => {
  const mod = await import("@gharargah/ui/terminal")
  return { default: mod.TerminalPanel }
})

export type SessionTerminalWorkspacePaneProps = {
  sessionTabId: string
  theme: GharargahTheme
  active: boolean
  /** When true, terminal tabs render in the session header. */
  headerActive?: boolean
  /** The session PTY is Terminal 1 only for non-agent sessions. */
  primaryTerminal?: ReactNode
  onOpenPath?: (path: string, line?: number, column?: number) => void
}

export function SessionTerminalWorkspacePane(
  props: SessionTerminalWorkspacePaneProps,
) {
  const {
    sessionTabId,
    theme,
    active,
    headerActive = false,
    primaryTerminal = null,
    onOpenPath,
  } = props
  const [, refresh] = useReducer((value: number) => value + 1, 0)

  useEffect(
    () =>
      subscribeTerminalSessions(tabId => {
        if (tabId === sessionTabId) {
          refresh()
          return
        }
        if (terminalSessionForTab(tabId)?.parentSessionTabId === sessionTabId) {
          refresh()
        }
      }),
    [sessionTabId],
  )

  const includePrimary = primaryTerminal != null
  const childTerminals = listSessionTerminals(sessionTabId)

  useEffect(() => {
    if (!active || includePrimary || childTerminals.length > 0) return
    addSessionTerminal(sessionTabId)
  }, [active, childTerminals.length, includePrimary, sessionTabId])

  const childItems: SessionTerminalItem[] = childTerminals.map(session => ({
    id: session.tabId,
    label: session.customLabel ?? "Terminal",
    content: (
      <Suspense fallback={null}>
        <TerminalPanel
          cwdRootUri={session.cwdRootUri}
          theme={theme}
          tabId={session.tabId}
          focused={active}
          isActive={
            activeSessionTerminalTabId(sessionTabId) === session.tabId
          }
          existingPtyId={session.ptyId}
          status={session.status}
          exitCode={session.exitCode}
          sessionGeneration={session.generation}
          onPtyId={trackTerminalPtyId}
          onInput={recordTerminalUserInput}
          onOutput={recordTerminalOutput}
          onFailed={() => markTerminalFailed(session.tabId)}
          onRestart={() => {
            const ptyId = terminalPtyIdForTab(session.tabId)
            if (ptyId) void window.gharargah?.terminal?.dispose(ptyId)
            applyAgentCliResumeLaunchArgs(session.tabId)
            restartTerminalSession(session.tabId)
          }}
          onClose={() => void closeTerminal(session.tabId)}
          onOpenPath={onOpenPath}
        />
      </Suspense>
    ),
  }))
  const items: SessionTerminalItem[] = includePrimary
    ? [
        {
          id: sessionTabId,
          label: "Terminal 1",
          content: primaryTerminal,
        },
        ...childItems,
      ]
    : childItems

  const requestedActiveId = activeSessionTerminalTabId(sessionTabId)
  const activeId =
    items.find(item => item.id === requestedActiveId)?.id ??
    items[0]?.id ??
    ""

  useEffect(() => {
    if (!activeId || requestedActiveId === activeId) return
    setActiveSessionTerminal(sessionTabId, activeId)
  }, [activeId, requestedActiveId, sessionTabId])

  async function closeTerminal(tabId: string): Promise<void> {
    if (tabId === sessionTabId) return
    const session = terminalSessionForTab(tabId)
    if (!session) return
    if (terminalSessionNeedsCloseConfirmation(session)) {
      const confirmed = await requestConfirm({
        title: `Close ${session.customLabel ?? "terminal"}?`,
        description: "The running shell process will be stopped.",
        confirmLabel: "Close Terminal",
        cancelLabel: "Keep Running",
        destructive: true,
      })
      if (!confirmed) return
    }
    if (session.ptyId) {
      void window.gharargah?.terminal?.dispose(session.ptyId)
    }
    removeSessionTerminal(sessionTabId, tabId)
  }

  return (
    <SessionTerminalWorkspace
      items={items}
      activeId={activeId}
      headerActive={headerActive}
      onActiveChange={tabId =>
        setActiveSessionTerminal(sessionTabId, tabId)
      }
      onAdd={() => {
        addSessionTerminal(sessionTabId, {
          minimumOrdinal: includePrimary ? 2 : 1,
        })
      }}
      onClose={tabId => void closeTerminal(tabId)}
      canClose={tabId => Boolean(tabId && tabId !== sessionTabId)}
    />
  )
}
