import { lazy, Suspense, useCallback, type ReactNode } from "react"
import type { PanelEvent } from "@yaade/panels"
import type { PanelId, PanelView, YaadeTheme } from "@yaade/shared"
import {
  MuxPaneChrome,
  PanelDock,
  type PanelSlotMeta,
  type TabDndHandlers,
} from "@yaade/ui"
import type { YaadePanelTree } from "@yaade/workspace"
import { isGitTabId, isTerminalTabId, panelTabIds } from "@yaade/workspace"
import { listPaneLeaves, muxLeafKind } from "./layout.js"

const GitWorkspace = lazy(() =>
  import("@yaade/ui/git").then(m => ({ default: m.GitWorkspace })),
)

export type MuxWindowViewProps = {
  tree: YaadePanelTree
  focusedPanelId: PanelId | null
  zoomedPaneId: string | null
  paneTitle: (tabId: string) => string
  onFocusPanel: (id: PanelId) => void
  onEvent: (event: PanelEvent) => void
  tabDnd: TabDndHandlers
  onSplit: (panelId: PanelId, edge: "right" | "bottom") => void
  onOpenGit: (panelId: PanelId) => void
  onZoom: (tabId: string) => void
  onClosePane: (panelId: PanelId, tabId: string) => void
  onNewWindow?: () => void
  /** Git pane workspace root (cwd / active project). */
  gitRootUri: string | null
  theme: YaadeTheme
  /** Terminals are painted by MuxTerminalLayer; slots are placeholders only. */
  empty: ReactNode
}

function muxLeafView(view: PanelView | null): PanelView {
  if (!view || view.kind !== "tabs") return { kind: "empty" }
  const tabIds = panelTabIds(view).filter(id => muxLeafKind(id) != null)
  if (tabIds.length === 0) return { kind: "empty" }
  const activeTabId = tabIds.includes(view.activeTabId)
    ? view.activeTabId
    : tabIds[0]!
  return { kind: "tabs", activeTabId, tabIds }
}

function PaneChromeShell(props: {
  tabId: string
  panelId: PanelId
  title: string
  focused: boolean
  zoomed: boolean
  canZoom: boolean
  onSplitRight: () => void
  onSplitDown: () => void
  onOpenGit: () => void
  onZoom: () => void
  onClose: () => void
  children: ReactNode
}) {
  const {
    tabId,
    panelId,
    title,
    focused,
    zoomed,
    canZoom,
    onSplitRight,
    onSplitDown,
    onOpenGit,
    onZoom,
    onClose,
    children,
  } = props

  return (
    <div
      className="group/mux-pane relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
      data-yaade-mux-pane={tabId}
      data-panel-id={panelId.id}
      data-yaade-mux-pane-kind={muxLeafKind(tabId) ?? undefined}
    >
      <MuxPaneChrome
        title={title}
        focused={focused}
        paneId={tabId}
        panelId={panelId}
        zoomed={zoomed}
        canZoom={canZoom}
        onSplitRight={onSplitRight}
        onSplitDown={onSplitDown}
        onOpenGit={onOpenGit}
        onZoom={onZoom}
        onClose={onClose}
      />
      {children}
    </div>
  )
}

function TerminalSlot(props: { tabId: string }) {
  return (
    <div
      className="min-h-0 flex-1 overflow-hidden"
      data-yaade-mux-terminal-slot={props.tabId}
    />
  )
}

function GitPaneBody(props: {
  rootUri: string | null
  theme: YaadeTheme
}) {
  return (
    <div className="min-h-0 flex-1 overflow-hidden pt-8">
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            Loading Git…
          </div>
        }
      >
        <GitWorkspace
          rootUri={props.rootUri}
          theme={props.theme}
          onOpenFile={() => {}}
        />
      </Suspense>
    </div>
  )
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
    onOpenGit,
    onZoom,
    onClosePane,
    gitRootUri,
    theme,
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

  const renderPane = useCallback(
    (
      tabId: string,
      panelId: PanelId,
      focused: boolean,
      zoomed: boolean,
    ) => {
      const body = isGitTabId(tabId) ? (
        <GitPaneBody rootUri={gitRootUri} theme={theme} />
      ) : isTerminalTabId(tabId) ? (
        <TerminalSlot tabId={tabId} />
      ) : (
        empty
      )

      return (
        <PaneChromeShell
          tabId={tabId}
          panelId={panelId}
          title={paneTitle(tabId)}
          focused={focused}
          zoomed={zoomed}
          canZoom={canZoom}
          onSplitRight={() => onSplit(panelId, "right")}
          onSplitDown={() => onSplit(panelId, "bottom")}
          onOpenGit={() => onOpenGit(panelId)}
          onZoom={() => onZoom(tabId)}
          onClose={() => onClosePane(panelId, tabId)}
        >
          {body}
        </PaneChromeShell>
      )
    },
    [
      canZoom,
      empty,
      gitRootUri,
      onClosePane,
      onOpenGit,
      onSplit,
      onZoom,
      paneTitle,
      theme,
    ],
  )

  const renderContent = useCallback(
    (view: PanelView, panelId: PanelId, meta: PanelSlotMeta) => {
      const leaf = muxLeafView(view)
      if (leaf.kind !== "tabs") return empty
      const tabId = leaf.activeTabId
      if (muxLeafKind(tabId) == null) return empty
      return renderPane(tabId, panelId, meta.focused, false)
    },
    [empty, renderPane],
  )

  if (zoomedLeaf) {
    return (
      <div
        className="flex h-full min-h-0 w-full flex-col overflow-hidden p-1.5"
        data-yaade-mux-window=""
        data-zoomed=""
      >
        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-[var(--glass-radius-panel)] border border-[color:var(--glass-rim)]">
          {renderPane(zoomedLeaf.ptyTabId, zoomedLeaf.panelId, true, true)}
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
