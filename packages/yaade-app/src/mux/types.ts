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

export type MuxWindowPersisted = {
  id: string
  title: string
  tree: PanelTreeSnapshot<PanelView>
  focusedPaneId: number | null
  zoomedPaneId: string | null
  paneOrder: string[]
}

export type MuxStatePersisted = {
  version: 1
  orientation: TabOrientation
  windows: MuxWindowPersisted[]
  activeWindowId: string | null
  /** Last cwd used for new panes (file:// URI). */
  lastCwdUri: string | null
}

export type MuxSwitcherEntry = {
  windowId: string
  windowTitle: string
  paneId: string
  ptyTabId: string
  title: string
  panelId: number
}
