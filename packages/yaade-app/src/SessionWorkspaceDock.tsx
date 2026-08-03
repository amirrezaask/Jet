import { useCallback, type ReactNode } from "react"
import type { PanelEvent, PanelTree } from "@yaade/panels"
import type { PanelId, PanelView } from "@yaade/shared"
import {
  PanelDock,
  PanelTabBar,
  type PanelSlotMeta,
  type TabDndHandlers,
  type TabStore,
  type TabTypeRegistry,
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
  tabStore: TabStore
  tabRegistry: TabTypeRegistry
  onHideSession: (panelId: PanelId, tabId: string) => void
  onActivateSession: (panelId: PanelId, tabId: string) => void
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
    tabStore,
    tabRegistry,
    onHideSession,
    onActivateSession,
    renderSession,
    empty,
  } = props

  const renderHeader = useCallback(
    (view: PanelView, panelId: PanelId, meta: PanelSlotMeta) => {
      const sessionView = terminalOnlyView(view)
      if (sessionView.kind === "empty") {
        return (
          <div
            data-yaade-session-window-chrome=""
            data-yaade-liquid-glass="chrome"
            className="flex h-9 shrink-0 items-center px-2"
          />
        )
      }
      return (
        <div
          data-yaade-session-window-chrome=""
          data-yaade-liquid-glass="chrome"
          className="shrink-0"
        >
          <PanelTabBar
            panelId={panelId}
            view={sessionView}
            store={tabStore}
            registry={tabRegistry}
            focused={meta.focused}
            onActivateTab={tabId => onActivateSession(panelId, tabId)}
            onCloseTab={tabId => onHideSession(panelId, tabId)}
          />
        </div>
      )
    },
    [onActivateSession, onHideSession, tabRegistry, tabStore],
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
