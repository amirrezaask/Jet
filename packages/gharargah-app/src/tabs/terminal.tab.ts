import { createElement, lazy, Suspense } from "react"
import type { TabType } from "@gharargah/ui"
import type { TabContributorDeps } from "./deps.js"
import {
  clearTerminalSession,
  registerTerminalSession,
  terminalCwdForTab,
  terminalLaunchCommandForTab,
  terminalPtyIdForTab,
  terminalSessionForTab,
  markTerminalFailed,
  restartTerminalSession,
  trackTerminalPtyId,
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
      const ptyId = terminalPtyIdForTab(instance.id)
      if (ptyId) void window.gharargah?.terminal?.dispose(ptyId)
      clearTerminalSession(instance.id)
    },
    render: (instance, ctx) => {
      const session = terminalSessionForTab(instance.id)
      const terminal = createElement(TerminalPanel, {
        cwdRootUri: instance.state.cwdRootUri,
        launchCommand: terminalLaunchCommandForTab(instance.id),
        theme: deps.getTheme(),
        tabId: instance.id,
        focused: ctx.focused && ctx.isActive,
        isActive: ctx.isActive,
        existingPtyId: session?.ptyId,
        status: session?.status,
        exitCode: session?.exitCode,
        sessionGeneration: session?.generation,
        onPtyId: trackTerminalPtyId,
        onTitleChange: deps.onTerminalTitleChange,
        onFailed: () => markTerminalFailed(instance.id),
        onRestart: () => {
          const ptyId = terminalPtyIdForTab(instance.id)
          if (ptyId) void window.gharargah?.terminal?.dispose(ptyId)
          restartTerminalSession(instance.id)
        },
        onClose: () => deps.closeTerminalTab(ctx.panelId, instance.id),
      })
      return createElement(Suspense, { fallback: null }, terminal)
    },
  }
}
