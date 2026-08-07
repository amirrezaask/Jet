import type { PanelTreeSnapshot } from "@yaade/panels"
import type { PanelView } from "@yaade/shared"

export type TabOrientation = "horizontal" | "vertical"

export type MuxPane = {
  id: string
  /** Terminal tab id (`yaade:terminal:…`) — also the PTY session key host. */
  ptyTabId: string
  title: string
  cwd?: string
}

/** Persisted metadata for a terminal leaf so reload can reattach. */
export type MuxSessionLeafPersisted = {
  ptyTabId: string
  ptyId?: string
  cwdRootUri: string
  liveCwdUri?: string
  launchCommand?: string
  launchArgs?: string[]
  label?: string
  agentProvider?: string
  agentTitle?: string
}

export type MuxWindowPersisted = {
  id: string
  title: string
  tree: PanelTreeSnapshot<PanelView>
  focusedPaneId: number | null
  zoomedPaneId: string | null
  /** @deprecated v1 write-only; ignored on read. */
  paneOrder?: string[]
  sessions?: MuxSessionLeafPersisted[]
}

export type MuxStatePersisted = {
  version: 1 | 2
  orientation: TabOrientation
  windows: MuxWindowPersisted[]
  activeWindowId: string | null
  /**
   * Boot-only default cwd (launch config / workspace folder).
   * Per-pane live cwd is authoritative for splits — do not overwrite on resolve.
   */
  lastCwdUri: string | null
  /** Per git-pane workspace root (file:// URI). */
  gitRoots?: Record<string, string>
}

export type MuxSwitcherEntry = {
  windowId: string
  windowTitle: string
  paneId: string
  ptyTabId: string
  title: string
  panelId: number
}
