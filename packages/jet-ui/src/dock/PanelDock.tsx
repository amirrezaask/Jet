import { Fragment, memo, useMemo } from "react"
import type { Extension } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import { PanelTree, type PanelEvent } from "@jet/panels"
import type { PanelId, PanelNode } from "@jet/shared"
import type { JetTheme } from "@jet/codemirror"
import type { KeymapContext, JetKeyBinding, WorkspaceService } from "@jet/workspace"
import type { LocationItem } from "@jet/workspace"
import type { Layout } from "react-resizable-panels"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable.js"
import { PanelBody } from "./PanelBody.js"
import { PanelHeader } from "./PanelHeader.js"

export type PanelDockProps = {
  tree: PanelTree
  workspace: WorkspaceService
  theme: JetTheme
  focusedPanelId: PanelId | null
  onFocusPanel: (id: PanelId) => void
  onEvent: (event: PanelEvent) => void
  resolveLspClient?: (fileUri: string) => Promise<import("@jet/codemirror").LSPClient | null>
  lspRevision?: number
  executeCommand: (name: string) => Promise<void>
  runKeyBinding: (binding: JetKeyBinding, view?: EditorView) => void
  onOpenFile: (uri: string, path: string) => void
  onOpenLocationItem: (item: LocationItem) => void
  keymapBindings: JetKeyBinding[]
  userExtensions: Extension[]
  keymapRevision: number
  keymapContext?: KeymapContext
  panelRev: number
  onEditorFocusChange?: (focused: boolean) => void
  onEditorSelectionChange?: (line: number, column: number, rangeCount: number) => void
  onLspAttachFailed?: (fileUri: string) => void
  onProblemsChange?: () => void
  dimInactive?: boolean
}

function splitPanelId(path: number[], index: number): string {
  return path.length === 0 ? `jet-split-${index}` : `jet-split-${path.join(".")}-${index}`
}

function splitGroupId(path: number[]): string {
  return path.length === 0 ? "jet-root-split" : `jet-split-group-${path.join(".")}`
}

function PanelLeaf({
  panelId,
  view,
  props,
  focused,
  dimmed,
  autoFocusEditor,
}: {
  panelId: PanelId
  view: PanelNode & { kind: "leaf" }
  props: PanelDockProps
  focused: boolean
  dimmed: boolean
  autoFocusEditor: boolean
}) {
  return (
    <div
      className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden border border-border/80 bg-background transition-opacity duration-150"
      style={{ opacity: dimmed ? 0.55 : 1 }}
      onMouseDown={() => props.onFocusPanel(panelId)}
    >
      <PanelHeader
        panelId={panelId}
        view={view.view}
        workspace={props.workspace}
        focused={focused}
        onClosePanel={id => props.onEvent({ type: "panelClose", panelId: id })}
        onSplitEditor={
          view.view.kind === "editor"
            ? () => void props.executeCommand("view.splitEditor")
            : undefined
        }
      />
      <div className="min-h-0 flex-1">
        {view.view.kind !== "empty" ? (
          <PanelBody
            panelId={panelId}
            view={view.view}
            workspace={props.workspace}
            theme={props.theme}
            resolveLspClient={props.resolveLspClient}
            lspRevision={props.lspRevision}
            executeCommand={props.executeCommand}
            runKeyBinding={props.runKeyBinding}
            onOpenFile={props.onOpenFile}
            onOpenLocationItem={props.onOpenLocationItem}
            keymapBindings={props.keymapBindings}
            userExtensions={props.userExtensions}
            keymapRevision={props.keymapRevision}
            keymapContext={props.keymapContext}
            onEditorFocusChange={props.onEditorFocusChange}
            onEditorSelectionChange={props.onEditorSelectionChange}
            onLspAttachFailed={props.onLspAttachFailed}
            onProblemsChange={props.onProblemsChange}
            autoFocus={autoFocusEditor}
          />
        ) : (
          <PanelBody
            panelId={panelId}
            view={{ kind: "empty" }}
            workspace={props.workspace}
            theme={props.theme}
            executeCommand={props.executeCommand}
            runKeyBinding={props.runKeyBinding}
            onOpenFile={props.onOpenFile}
            onOpenLocationItem={props.onOpenLocationItem}
            keymapBindings={props.keymapBindings}
            userExtensions={props.userExtensions}
            keymapRevision={props.keymapRevision}
            keymapContext={props.keymapContext}
          />
        )}
      </div>
    </div>
  )
}

function splitStructureKey(node: PanelNode): string {
  if (node.kind === "leaf") return `leaf-${node.panelId.id}`
  return `${node.kind}:${node.split.children.map(splitStructureKey).join("|")}`
}

function PanelSplitNode({
  node,
  path,
  props,
}: {
  node: Extract<PanelNode, { kind: "row" | "column" }>
  path: number[]
  props: PanelDockProps
}) {
  const orientation = node.kind === "row" ? "horizontal" : "vertical"
  const { children, ratios } = node.split

  const defaultLayout = useMemo(() => {
    const layout: Layout = {}
    children.forEach((_, index) => {
      layout[splitPanelId(path, index)] = ratios[index]! * 100
    })
    return layout
  }, [children.length, path.join("."), ratios.join(",")])

  return (
    <ResizablePanelGroup
      key={splitStructureKey(node)}
      id={splitGroupId(path)}
      orientation={orientation}
      defaultLayout={defaultLayout}
      className="h-full w-full"
      onLayoutChanged={layout => {
        const nextRatios = children.map(
          (_, index) => (layout[splitPanelId(path, index)] ?? ratios[index]! * 100) / 100,
        )
        const changed = nextRatios.some(
          (ratio, index) => Math.abs(ratio - ratios[index]!) > 0.005,
        )
        if (!changed) return
        props.onEvent({ type: "splitRatiosChanged", path, ratios: nextRatios })
      }}
    >
      {children.map((child, index) => (
        <Fragment key={splitPanelId(path, index)}>
          {index > 0 ? <ResizableHandle withHandle /> : null}
          <ResizablePanel
            id={splitPanelId(path, index)}
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

function PanelTreeNode({
  node,
  path,
  props,
}: {
  node: PanelNode
  path: number[]
  props: PanelDockProps
}) {
  if (node.kind === "leaf") {
    const focused = props.focusedPanelId?.id === node.panelId.id
    const autoFocusEditor = focused && node.view.kind === "editor"
    const dimmed =
      props.dimInactive !== false && node.view.kind === "editor" && !focused
    return (
      <div className="flex h-full min-h-0 w-full flex-1 flex-col">
        <PanelLeaf
          panelId={node.panelId}
          view={node}
          props={props}
          focused={focused}
          dimmed={dimmed}
          autoFocusEditor={autoFocusEditor}
        />
      </div>
    )
  }

  return <PanelSplitNode node={node} path={path} props={props} />
}

export function PanelDockInner(props: PanelDockProps) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden" data-jet-panel-dock>
      <PanelTreeNode node={props.tree.root} path={[]} props={props} />
    </div>
  )
}

export const PanelDock = memo(PanelDockInner)
