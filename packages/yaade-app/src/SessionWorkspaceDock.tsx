import { useCallback, type ReactNode } from "react"
import type { PanelEvent, PanelTree } from "@yaade/panels"
import type { PanelId, PanelView } from "@yaade/shared"
import {
  PanelDock,
  type PanelSlotMeta,
  type TabDndHandlers,
} from "@yaade/ui"
import { isTerminalTabId } from "@yaade/workspace"
import { terminalOnlyView } from "./session-layout.js"

export type SessionWorkspaceDockProps = {
  tree: PanelTree<PanelView>
  focusedPanelId: PanelId | null
  onFocusPanel: (id: PanelId) => void
  onEvent: (event: PanelEvent) => void
  tabDnd: TabDndHandlers
  /** Parent owns TabDndRoot when false (default true for standalone docks). */
  wrapTabDnd?: boolean
  renderSession: (
    sessionTabId: string,
    panelId: PanelId,
    meta: PanelSlotMeta,
  ) => ReactNode
  empty: ReactNode
}

export function SessionWorkspaceDock(props: SessionWorkspaceDockProps) {
  const {
    tree,
    focusedPanelId,
    onFocusPanel,
    onEvent,
    tabDnd,
    wrapTabDnd = true,
    renderSession,
    empty,
  } = props

  // Titlebar lives inside the session host (single row: title + actions + close).
  const renderHeader = useCallback(
    (_view: PanelView, _panelId: PanelId, _meta: PanelSlotMeta) => null,
    [],
  )

  const renderContent = useCallback(
    (view: PanelView, panelId: PanelId, meta: PanelSlotMeta) => {
      const sessionView = terminalOnlyView(view)
      if (sessionView.kind !== "tabs") {
        return empty
      }
      const active = sessionView.activeTabId
      if (!isTerminalTabId(active)) return empty
      return (
        <div
          className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
          data-yaade-session-window-body=""
        >
          {renderSession(active, panelId, meta)}
        </div>
      )
    },
    [empty, renderSession],
  )

  return (
    <div
      className="h-full min-h-0 w-full p-2"
      data-yaade-session-workspace=""
    >
      <PanelDock
        tree={tree}
        focusedPanelId={focusedPanelId}
        onFocusPanel={onFocusPanel}
        onEvent={onEvent}
        tabDnd={tabDnd}
        wrapTabDnd={wrapTabDnd}
        renderHeader={renderHeader}
        renderContent={renderContent}
      />
    </div>
  )
}
