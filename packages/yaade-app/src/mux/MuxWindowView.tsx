import { useCallback, type ReactNode } from "react"
import type { PanelEvent } from "@yaade/panels"
import type { PanelId, PanelView } from "@yaade/shared"
import {
  MuxPaneChrome,
  PanelDock,
  type PanelSlotMeta,
  type TabDndHandlers,
} from "@yaade/ui"
import type { YaadePanelTree } from "@yaade/workspace"
import { isTerminalTabId, panelTabIds } from "@yaade/workspace"
import { listPaneLeaves } from "./layout.js"

export type MuxWindowViewProps = {
  tree: YaadePanelTree
  focusedPanelId: PanelId | null
  zoomedPaneId: string | null
  paneTitle: (ptyTabId: string) => string
  onFocusPanel: (id: PanelId) => void
  onEvent: (event: PanelEvent) => void
  tabDnd: TabDndHandlers
  onSplit: (panelId: PanelId, edge: "right" | "bottom") => void
  onZoom: (ptyTabId: string) => void
  onClosePane: (panelId: PanelId, ptyTabId: string) => void
  renderTerminal: (ptyTabId: string, focused: boolean) => ReactNode
  empty: ReactNode
}

function terminalLeafView(view: PanelView | null): PanelView {
  if (!view || view.kind !== "tabs") return { kind: "empty" }
  const tabIds = panelTabIds(view).filter(isTerminalTabId)
  if (tabIds.length === 0) return { kind: "empty" }
  const activeTabId = tabIds.includes(view.activeTabId)
    ? view.activeTabId
    : tabIds[0]!
  return { kind: "tabs", activeTabId, tabIds }
}

export function MuxWindowView(props: MuxWindowViewProps) {
  const {
    tree,
    focusedPanelId,
    zoomedPaneId,
    paneTitle,
    onFocusPanel,
    onEvent,
    tabDnd,
    onSplit,
    onZoom,
    onClosePane,
    renderTerminal,
    empty,
  } = props

  const paneCount = listPaneLeaves(tree).length
  const canZoom = paneCount > 1
  const zoomedLeaf =
    zoomedPaneId != null
      ? listPaneLeaves(tree).find(p => p.ptyTabId === zoomedPaneId)
      : null

  const renderHeader = useCallback(
    (_view: PanelView, _panelId: PanelId, _meta: PanelSlotMeta) => null,
    [],
  )

  const renderContent = useCallback(
    (view: PanelView, panelId: PanelId, meta: PanelSlotMeta) => {
      const leaf = terminalLeafView(view)
      if (leaf.kind !== "tabs") return empty
      const ptyTabId = leaf.activeTabId
      if (!isTerminalTabId(ptyTabId)) return empty
      return (
        <div
          className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
          data-yaade-mux-pane={ptyTabId}
          data-panel-id={panelId.id}
        >
          <MuxPaneChrome
            title={paneTitle(ptyTabId)}
            focused={meta.focused}
            paneId={ptyTabId}
            panelId={panelId}
            zoomed={false}
            canZoom={canZoom}
            onSplitRight={() => onSplit(panelId, "right")}
            onSplitDown={() => onSplit(panelId, "bottom")}
            onZoom={() => onZoom(ptyTabId)}
            onClose={() => onClosePane(panelId, ptyTabId)}
          />
          <div className="min-h-0 flex-1 overflow-hidden">
            {renderTerminal(ptyTabId, meta.focused)}
          </div>
        </div>
      )
    },
    [canZoom, empty, onClosePane, onSplit, onZoom, paneTitle, renderTerminal],
  )

  if (zoomedLeaf) {
    return (
      <div
        className="flex h-full min-h-0 w-full flex-col overflow-hidden p-1.5"
        data-yaade-mux-window=""
        data-zoomed=""
      >
        <div
          className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--glass-radius-panel)] border border-[color:var(--glass-rim)]"
          data-yaade-mux-pane={zoomedLeaf.ptyTabId}
          data-panel-id={zoomedLeaf.panelId.id}
        >
          <MuxPaneChrome
            title={paneTitle(zoomedLeaf.ptyTabId)}
            focused
            paneId={zoomedLeaf.ptyTabId}
            panelId={zoomedLeaf.panelId}
            zoomed
            canZoom
            onSplitRight={() => onSplit(zoomedLeaf.panelId, "right")}
            onSplitDown={() => onSplit(zoomedLeaf.panelId, "bottom")}
            onZoom={() => onZoom(zoomedLeaf.ptyTabId)}
            onClose={() =>
              onClosePane(zoomedLeaf.panelId, zoomedLeaf.ptyTabId)
            }
          />
          <div className="min-h-0 flex-1 overflow-hidden">
            {renderTerminal(zoomedLeaf.ptyTabId, true)}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full min-h-0 w-full p-1.5" data-yaade-mux-window="">
      <PanelDock
        tree={tree}
        focusedPanelId={focusedPanelId}
        onFocusPanel={onFocusPanel}
        onEvent={onEvent}
        tabDnd={tabDnd}
        wrapTabDnd={false}
        renderHeader={renderHeader}
        renderContent={renderContent}
      />
    </div>
  )
}
