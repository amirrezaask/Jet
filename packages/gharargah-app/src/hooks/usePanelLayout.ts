import { useCallback, useMemo, useRef, useState } from "react"
import type { PanelEvent } from "@gharargah/panels"
import type { PanelId, DropAction } from "@gharargah/shared"
import {
  GharargahPanelTree,
  activatePanelTab,
  reorderPanelTab,
  popPanelTab,
  panelTabIds,
  type WorkspaceService,
} from "@gharargah/workspace"
import type { TabStore } from "@gharargah/ui"
import {
  getAllLeafPanels,
  closePanelIfEmpty,
  reconcileFocusedPanel,
} from "../panel-routing.js"

function initialEditorLayout() {
  return GharargahPanelTree.editorOnlyLayout()
}

export type PanelLayoutState = {
  panelTree: GharargahPanelTree
  focusedPanel: PanelId | null
  editorPanelRef: React.MutableRefObject<PanelId | null>
}

export function usePanelLayout(
  workspace: WorkspaceService,
  tabStore: TabStore,
  appStateRef: React.MutableRefObject<PanelLayoutState & Record<string, unknown>>,
) {
  const initialLayoutRef = useRef<ReturnType<typeof initialEditorLayout> | null>(null)
  if (initialLayoutRef.current == null) initialLayoutRef.current = initialEditorLayout()
  const initialLayout = initialLayoutRef.current

  const [panelTree, setPanelTree] = useState(() => initialLayout.tree)
  const [focusedPanel, setFocusedPanel] = useState<PanelId | null>(() => initialLayout.editorPanel)
  const editorPanelRef = useRef<PanelId | null>(initialLayout.editorPanel)

  const cloneTree = useCallback(() => appStateRef.current.panelTree.clone(), [appStateRef])

  const commitTree = useCallback(
    (tree: GharargahPanelTree, preferFocus?: PanelId | null) => {
      const prevFocused = appStateRef.current.focusedPanel
      const preferred =
        preferFocus && getAllLeafPanels(tree).some(l => l.id === preferFocus.id)
          ? preferFocus
          : null
      const nextFocused =
        preferred ?? reconcileFocusedPanel(tree, prevFocused, editorPanelRef.current)
      setPanelTree(tree)
      setFocusedPanel(nextFocused)
    },
    [appStateRef],
  )

  const handlePanelEvent = useCallback(
    (event: PanelEvent) => {
      const tree = cloneTree()
      let changed = true
      if (event.type === "splitRatiosChanged") {
        changed = tree.setSplitRatios(event.path, event.ratios)
      } else if (event.type === "panelClose") {
        const view = tree.getView(event.panelId)
        if (view?.kind === "tabs") {
          for (const tabId of panelTabIds(view)) {
            workspace.disposeTab(tabId)
            tabStore.dispose(tabId)
          }
        }
        tree.closePanel(event.panelId)
        commitTree(tree)
        changed = false
      } else if (event.type === "tabActivate") {
        const view = tree.getView(event.panelId)
        if (view?.kind !== "tabs" || view.activeTabId === event.tabId) {
          changed = false
        } else {
          tree.setView(event.panelId, activatePanelTab(view, event.tabId))
          setFocusedPanel(event.panelId)
        }
      } else if (event.type === "tabClose") {
        const view = tree.getView(event.panelId)
        if (view?.kind !== "tabs") {
          changed = false
        } else {
          workspace.disposeTab(event.tabId)
          tabStore.dispose(event.tabId)
          tree.setView(event.panelId, popPanelTab(view, event.tabId))
          closePanelIfEmpty(tree, event.panelId)
        }
      } else if (event.type === "tabReorder") {
        const view = tree.getView(event.panelId)
        if (view?.kind !== "tabs") {
          changed = false
        } else {
          tree.setView(event.panelId, reorderPanelTab(view, event.tabId, event.toIndex))
        }
      } else if (event.type === "tabDrop") {
        const result = tree.applyTabDrop(
          event.source,
          event.sourceTabId,
          event.target,
          event.action,
        )
        if (!result.moved) {
          changed = false
        } else {
          commitTree(tree, result.createdPanel ?? event.target)
          changed = false
        }
      }
      if (changed) commitTree(tree)
    },
    [cloneTree, commitTree, workspace, tabStore],
  )

  const tabDndHandlers = useMemo(
    () => ({
      onTabReorder: (panelId: PanelId, tabId: string, toIndex: number) => {
        handlePanelEvent({ type: "tabReorder", panelId, tabId, toIndex })
      },
      onTabDrop: (source: PanelId, sourceTabId: string, target: PanelId, action: DropAction) => {
        handlePanelEvent({ type: "tabDrop", source, sourceTabId, target, action })
      },
      tabIdsForPanel: (panelId: PanelId) => {
        const view = appStateRef.current.panelTree.getView(panelId)
        return view?.kind === "tabs" ? panelTabIds(view) : []
      },
    }),
    [handlePanelEvent, appStateRef],
  )

  return {
    panelTree,
    focusedPanel,
    setFocusedPanel,
    editorPanelRef,
    cloneTree,
    commitTree,
    handlePanelEvent,
    tabDndHandlers,
  }
}
