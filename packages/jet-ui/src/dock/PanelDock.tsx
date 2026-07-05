import { Fragment, memo, useEffect, useMemo, useState, type DragEvent, type ReactNode } from "react"
import type { PanelEvent, PanelNode } from "@jet/panels"
import type { PanelTree } from "@jet/panels"
import type { PanelId } from "@jet/shared"
import type { Layout } from "react-resizable-panels"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable.js"
import { cn } from "@/lib/utils.js"
import { PanelDragProvider, TAB_DRAG_MIME, usePanelDrag } from "./PanelDragContext.js"
import { PanelDropOverlay } from "./PanelDropOverlay.js"

export type PanelSlotMeta = {
  focused: boolean
  onClose: () => void
}

export type PanelDockProps<TView> = {
  tree: PanelTree<TView>
  focusedPanelId: PanelId | null
  onFocusPanel: (id: PanelId) => void
  onEvent: (event: PanelEvent) => void
  /** Render the header for a panel. Receives the view + focus/close actions. */
  renderHeader: (view: TView, panelId: PanelId, meta: PanelSlotMeta) => ReactNode
  /** Render the body content for a panel. */
  renderContent: (view: TView, panelId: PanelId, meta: PanelSlotMeta) => ReactNode
  /** Stable structural key for the view — controls re-mount vs update. Default: view.kind + panelId. */
  contentKey?: (view: TView, panelId: PanelId) => string
}

function splitPanelDomId(path: number[], index: number): string {
  return path.length === 0 ? `jet-split-${index}` : `jet-split-${path.join(".")}-${index}`
}

function splitGroupDomId(path: number[]): string {
  return path.length === 0 ? "jet-root-split" : `jet-split-group-${path.join(".")}`
}

function structureKey<TView>(node: PanelNode<TView>): string {
  if (node.kind === "leaf") return `leaf-${node.panelId.id}`
  return `${node.kind}:${node.split.children.map(structureKey).join("|")}`
}

function PanelLeaf<TView>({
  panelId,
  view,
  focused,
  onFocusPanel,
  onEvent,
  renderHeader,
  renderContent,
}: {
  panelId: PanelId
  view: TView
  focused: boolean
  onFocusPanel: (id: PanelId) => void
  onEvent: (event: PanelEvent) => void
  renderHeader: PanelDockProps<TView>["renderHeader"]
  renderContent: PanelDockProps<TView>["renderContent"]
}) {
  const drag = usePanelDrag()
  const [dragOver, setDragOver] = useState(false)
  const onClose = () => onEvent({ type: "panelClose", panelId })
  const meta: PanelSlotMeta = { focused, onClose }
  const tabDrag = drag.tabSource
  const isDropTarget =
    tabDrag != null && tabDrag.panelId.id !== panelId.id

  useEffect(() => {
    if (!tabDrag) setDragOver(false)
  }, [tabDrag])

  const onLeafDragEnter = (e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes(TAB_DRAG_MIME)) return
    if (isDropTarget) setDragOver(true)
  }
  const onLeafDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
    setDragOver(false)
  }
  const onLeafDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes(TAB_DRAG_MIME)) return
    if (isDropTarget) {
      e.preventDefault()
      setDragOver(true)
    }
  }
  const onLeafDrop = () => setDragOver(false)

  return (
    <div
      className={cn(
        "relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden border bg-background",
        dragOver && isDropTarget
          ? "border-primary/50 ring-1 ring-primary/30"
          : "border-border/80",
      )}
      data-jet-panel-leaf={panelId.id}
      data-jet-panel-dragged-over={dragOver && isDropTarget ? "" : undefined}
      onMouseDown={e => {
        // Skip focus on draggable descendants to avoid disrupting drag start.
        const t = e.target as HTMLElement | null
        if (t && (t.closest("[draggable=true]") || t.closest("[data-tab-id]"))) return
        onFocusPanel(panelId)
      }}
      onDragEnter={onLeafDragEnter}
      onDragLeave={onLeafDragLeave}
      onDragOver={onLeafDragOver}
      onDrop={onLeafDrop}
    >
      {renderHeader(view, panelId, meta)}
      <div className="relative min-h-0 flex-1">
        {renderContent(view, panelId, meta)}
        <PanelDropOverlay
          panelId={panelId}
          onTabDrop={(source, sourceUri, target, action) =>
            onEvent({ type: "tabDrop", source, sourceUri, target, action })
          }
        />
      </div>
    </div>
  )
}

function PanelSplitNode<TView>({
  node,
  path,
  props,
}: {
  node: Extract<PanelNode<TView>, { kind: "row" | "column" }>
  path: number[]
  props: PanelDockProps<TView>
}) {
  const orientation = node.kind === "row" ? "horizontal" : "vertical"
  const { children, ratios } = node.split

  const defaultLayout = useMemo(() => {
    const layout: Layout = {}
    children.forEach((_, index) => {
      layout[splitPanelDomId(path, index)] = ratios[index]! * 100
    })
    return layout
  }, [children.length, path.join("."), ratios.join(",")])

  return (
    <ResizablePanelGroup
      key={structureKey(node)}
      id={splitGroupDomId(path)}
      orientation={orientation}
      defaultLayout={defaultLayout}
      className="h-full w-full"
      onLayoutChanged={layout => {
        const nextRatios = children.map(
          (_, index) => (layout[splitPanelDomId(path, index)] ?? ratios[index]! * 100) / 100,
        )
        const changed = nextRatios.some(
          (ratio, index) => Math.abs(ratio - ratios[index]!) > 0.005,
        )
        if (!changed) return
        props.onEvent({ type: "splitRatiosChanged", path, ratios: nextRatios })
      }}
    >
      {children.map((child, index) => (
        <Fragment key={splitPanelDomId(path, index)}>
          {index > 0 ? <ResizableHandle withHandle /> : null}
          <ResizablePanel
            id={splitPanelDomId(path, index)}
            defaultSize={`${ratios[index]! * 100}`}
            minSize="8"
            className="min-h-0 min-w-0"
          >
            <PanelTreeNode node={child} path={[...path, index]} props={props} />
          </ResizablePanel>
        </Fragment>
      ))}
    </ResizablePanelGroup>
  )
}

function PanelTreeNode<TView>({
  node,
  path,
  props,
}: {
  node: PanelNode<TView>
  path: number[]
  props: PanelDockProps<TView>
}) {
  if (node.kind === "leaf") {
    const focused = props.focusedPanelId?.id === node.panelId.id
    return (
      <div className="flex h-full min-h-0 w-full flex-1 flex-col">
        <PanelLeaf
          panelId={node.panelId}
          view={node.view}
          focused={focused}
          onFocusPanel={props.onFocusPanel}
          onEvent={props.onEvent}
          renderHeader={props.renderHeader}
          renderContent={props.renderContent}
        />
      </div>
    )
  }
  return <PanelSplitNode node={node} path={path} props={props} />
}

function PanelDockInner<TView>(props: PanelDockProps<TView>) {
  return (
    <PanelDragProvider>
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden" data-jet-panel-dock>
        <PanelTreeNode node={props.tree.root} path={[]} props={props} />
      </div>
    </PanelDragProvider>
  )
}

export const PanelDock = memo(PanelDockInner) as <TView>(
  props: PanelDockProps<TView>,
) => ReactNode
