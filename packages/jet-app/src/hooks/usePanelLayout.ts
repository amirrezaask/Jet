import { useCallback, useMemo, useRef, useState } from "react"
import type { PanelEvent } from "@jet/panels"
import type { PanelId, DropAction } from "@jet/shared"
import {
  JetPanelTree,
  activatePanelTab,
  reorderPanelTab,
  popPanelTab,
  panelTabIds,
  type WorkspaceService,
} from "@jet/workspace"
import {
  animateLayoutMorph,
  capturePanelLeafRects,
  destroyEditorBuffer,
  getEditorView,
  type PanelRect,
  type TabStore,
} from "@jet/ui"
import { getJetSearchState } from "@jet/codemirror"
import {
  getAllLeafPanels,
  closePanelIfEmpty,
  reconcileFocusedPanel,
} from "../panel-routing.js"
import { stripSidebarTabsFromTree } from "../sidebar-tree.js"

function initialEditorLayout() {
  return JetPanelTree.editorOnlyLayout()
}

export type PanelLayoutState = {
  panelTree: JetPanelTree
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
    (
      tree: JetPanelTree,
      preferFocus?: PanelId | null,
      morph?: { animate?: boolean; beforeRects?: Map<number, PanelRect>; spawnFrom?: Map<number, PanelRect> },
    ) => {
      stripSidebarTabsFromTree(tree)
      const beforeRects =
        morph?.animate ? (morph.beforeRects ?? capturePanelLeafRects()) : null
      const prevFocused = appStateRef.current.focusedPanel
      const preferred =
        preferFocus && getAllLeafPanels(tree).some(l => l.id === preferFocus.id)
          ? preferFocus
          : null
      const nextFocused =
        preferred ?? reconcileFocusedPanel(tree, prevFocused, editorPanelRef.current)
      setPanelTree(tree)
      setFocusedPanel(nextFocused)
      if (beforeRects) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            void animateLayoutMorph(beforeRects, { spawnFrom: morph?.spawnFrom })
          })
        })
      }
      if (nextFocused && nextFocused.id !== prevFocused?.id) {
        requestAnimationFrame(() => {
          if (getJetSearchState()?.open) return
          getEditorView(nextFocused)?.focus()
        })
      }
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
        const morphBefore = capturePanelLeafRects()
        const view = tree.getView(event.panelId)
        if (view?.kind === "tabs") {
          for (const tabId of panelTabIds(view)) {
            const kind = workspace.tabRegistry.kindFor(tabId)
            if (kind === "editor") {
              destroyEditorBuffer(event.panelId, tabId)
            }
            workspace.disposeTab(tabId)
            tabStore.dispose(tabId)
          }
        }
        tree.closePanel(event.panelId)
        commitTree(tree, undefined, { animate: true, beforeRects: morphBefore })
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
          const kind = workspace.tabRegistry.kindFor(event.tabId)
          if (kind === "editor") {
            destroyEditorBuffer(event.panelId, event.tabId)
          }
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
        const kind = workspace.tabRegistry.kindFor(event.sourceTabId)
        if (kind === "editor") {
          destroyEditorBuffer(event.source, event.sourceTabId)
        }
        const morphBefore = capturePanelLeafRects()
        const result = tree.applyTabDrop(
          event.source,
          event.sourceTabId,
          event.target,
          event.action,
        )
        if (!result.moved) {
          changed = false
        }
        if (changed) {
          commitTree(tree, result.createdPanel ?? event.target, {
            animate: true,
            beforeRects: morphBefore,
            spawnFrom: result.createdPanel
              ? new Map([
                  [
                    result.createdPanel.id,
                    morphBefore.get(event.target.id) ?? { x: 0, y: 0, w: 0, h: 0 },
                  ],
                ])
              : undefined,
          })
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
