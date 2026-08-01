import { createElement, lazy, Suspense } from "react"
import type { TabType } from "@gharargah/ui"
import type { TabContributorDeps } from "./deps.js"
import {
  captureAgentCliSessionFromOutput,
  isAgentCliProvider,
  syncAgentCliLaunchArgs,
} from "../agent-cli-launch.js"
import { applyAgentCliResumeLaunchArgs } from "../agent-cli-resume.js"
import { isActiveAgentWarmResumePending } from "../background-agent-cli-resume.js"
import {
  clearTerminalSession,
  isSessionArchived,
  registerTerminalSession,
  terminalCwdForTab,
  terminalLaunchCommandForTab,
  terminalLaunchArgsForTab,
  terminalLaunchEnvForTab,
  terminalPtyIdsForSession,
  terminalPtyIdForTab,
  terminalSessionForTab,
  markTerminalFailed,
  recordTerminalOutput,
  recordTerminalUserInput,
  restartTerminalSession,
  setAgentCliSessionId,
  trackTerminalPtyId,
  updateTerminalLaunchArgs,
} from "./terminal-session.js"

import type { KnownTabKind } from "@gharargah/workspace"

const TerminalPanel = lazy(async () => {
  const mod = await import("@gharargah/ui/terminal")
  return { default: mod.TerminalPanel }
})

export const TERMINAL_TAB_TYPE_ID: KnownTabKind = "terminal"
export { registerTerminalSession, terminalCwdForTab }

export type TerminalTabState = { label: string; cwdRootUri: string }

export function createTerminalTabType(deps: TabContributorDeps): TabType<TerminalTabState> {
  return {
    id: TERMINAL_TAB_TYPE_ID,
    keepMounted: true,
    title: state => state.label,
    dispose: instance => {
      for (const ptyId of terminalPtyIdsForSession(instance.id)) {
        void window.gharargah?.terminal?.dispose(ptyId)
      }
      clearTerminalSession(instance.id)
    },
    render: (instance, ctx) => {
      const session = terminalSessionForTab(instance.id)
      const terminal = createElement(TerminalPanel, {
        cwdRootUri: instance.state.cwdRootUri,
        launchCommand: terminalLaunchCommandForTab(instance.id),
        launchArgs: terminalLaunchArgsForTab(instance.id),
        launchEnv: terminalLaunchEnvForTab(instance.id),
        initialOutput: isSessionArchived(instance.id)
          ? session?.transcript
          : undefined,
        theme: deps.getTheme(),
        tabId: instance.id,
        focused: ctx.focused && ctx.isActive,
        isActive: ctx.isActive,
        existingPtyId: session?.ptyId,
        status: session?.status,
        exitCode: session?.exitCode,
        sessionGeneration: session?.generation,
        readOnly: isSessionArchived(instance.id),
        deferPty: isActiveAgentWarmResumePending(instance.id),
        startingMessage: "Resuming agent session…",
        onPtyId: trackTerminalPtyId,
        onInput: recordTerminalUserInput,
        onOutput: (tabId, data) => {
          recordTerminalOutput(tabId, data)
          if (!data) return
          const current = terminalSessionForTab(tabId)
          if (!current?.agentId || current.agentCliSessionId) return
          captureAgentCliSessionFromOutput(
            tabId,
            isAgentCliProvider(current.agentId) ? current.agentId : undefined,
            data,
            (id, cliSessionId) => {
              setAgentCliSessionId(id, cliSessionId)
              const next = terminalSessionForTab(id)
              if (next?.agentId && isAgentCliProvider(next.agentId)) {
                updateTerminalLaunchArgs(
                  id,
                  syncAgentCliLaunchArgs(id, next.agentId, cliSessionId),
                )
              }
            },
          )
        },
        onTitleChange: deps.onTerminalTitleChange,
        // Keep the failed session visible so the error and Restart action survives.
        onFailed: () => markTerminalFailed(instance.id),
        onRestart: () => {
          const ptyId = terminalPtyIdForTab(instance.id)
          if (ptyId) void window.gharargah?.terminal?.dispose(ptyId)
          applyAgentCliResumeLaunchArgs(instance.id)
          restartTerminalSession(instance.id)
        },
        onClose: () => deps.closeTerminalTab(ctx.panelId, instance.id),
        onOpenPath: deps.onOpenPath
          ? (path, line, column) =>
              deps.onOpenPath?.(instance.state.cwdRootUri, path, line, column)
          : undefined,
      })
      return createElement(Suspense, { fallback: null }, terminal)
    },
  }
}
