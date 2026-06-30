import { memo, useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import type { Extension } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import { PanelTree, type PanelEvent } from "@jet/panels"
import type { PanelId } from "@jet/shared"
import type { JetTheme } from "@jet/codemirror"
import type { KeymapContext, JetKeyBinding, WorkspaceService } from "@jet/workspace"
import type { LocationItem } from "@jet/workspace"
import { PanelHeader } from "./PanelHeader.js"
import { PanelBody } from "./PanelBody.js"

const SPLITTER_HIT_SLOP = 12

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
  onEditorSelectionChange?: (line: number, column: number) => void
  onLspAttachFailed?: (fileUri: string) => void
  onProblemsChange?: () => void
}

export function PanelDockInner(props: PanelDockProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ x: 0, y: 0, width: 800, height: 600 })
  const measureRafRef = useRef<number | null>(null)

  const measure = useCallback(() => {
    const el = viewportRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setViewport({ x: 0, y: 0, width: r.width, height: r.height })
  }, [])

  const scheduleMeasure = useCallback(() => {
    if (measureRafRef.current != null) return
    measureRafRef.current = requestAnimationFrame(() => {
      measureRafRef.current = null
      measure()
    })
  }, [measure])

  useEffect(() => {
    measure()
    const ro = new ResizeObserver(() => scheduleMeasure())
    const el = viewportRef.current
    if (el) ro.observe(el)
    return () => {
      ro.disconnect()
      if (measureRafRef.current != null) cancelAnimationFrame(measureRafRef.current)
    }
  }, [measure, scheduleMeasure, props.panelRev])

  const rects = props.tree.computeRects(viewport)
  const splitters = props.tree.splitterHits(viewport)

  const leaves: { panelId: PanelId; rect: { x: number; y: number; width: number; height: number } }[] = []
  for (const [panelNum, rect] of rects) {
    leaves.push({ panelId: { id: panelNum }, rect })
  }

  return (
    <div ref={viewportRef} className="relative h-full w-full overflow-hidden">
      {leaves.map(({ panelId, rect }) => {
        const panelNum = panelId.id
        const view = props.tree.getView(panelId)
        const autoFocusEditor =
          props.focusedPanelId?.id === panelNum && view?.kind === "editor"
        return (
          <div
            key={panelNum}
            className="absolute flex flex-col overflow-hidden border border-[var(--jet-border)] bg-[var(--jet-panel)]"
            style={{
              left: rect.x,
              top: rect.y,
              width: rect.width,
              height: rect.height,
            }}
            onMouseDown={() => props.onFocusPanel(panelId)}
          >
            <PanelHeader
              panelId={panelId}
              view={view}
              workspace={props.workspace}
              focused={props.focusedPanelId?.id === panelNum}
              onClosePanel={id => props.onEvent({ type: "panelClose", panelId: id })}
            />
            <div className="min-h-0 flex-1">
              {view && view.kind !== "empty" ? (
                <PanelBody
                  panelId={panelId}
                  view={view}
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
      })}

      {splitters.map((hit, i) => {
        const horizontal = hit.axis === "horizontal"
        const slopX = horizontal
          ? hit.rect.x - (SPLITTER_HIT_SLOP - hit.rect.width) / 2
          : hit.rect.x
        const slopY = horizontal
          ? hit.rect.y
          : hit.rect.y - (SPLITTER_HIT_SLOP - hit.rect.height) / 2
        const slopW = horizontal ? SPLITTER_HIT_SLOP : hit.rect.width
        const slopH = horizontal ? hit.rect.height : SPLITTER_HIT_SLOP

        return (
          <div
            key={i}
            className="absolute z-10 touch-none"
            style={{
              left: slopX,
              top: slopY,
              width: slopW,
              height: slopH,
              cursor: horizontal ? "col-resize" : "row-resize",
            }}
            onPointerDown={(e: ReactPointerEvent) => {
              e.preventDefault()
              e.currentTarget.setPointerCapture(e.pointerId)
              const start = horizontal ? e.clientX : e.clientY
              const onMove = (ev: PointerEvent) => {
                const delta = (horizontal ? ev.clientX : ev.clientY) - start
                props.onEvent({
                  type: "splitResized",
                  path: hit.path,
                  splitterIndex: hit.index,
                  deltaPx: delta,
                  viewport,
                })
              }
              const onUp = () => {
                window.removeEventListener("pointermove", onMove)
                window.removeEventListener("pointerup", onUp)
              }
              window.addEventListener("pointermove", onMove)
              window.addEventListener("pointerup", onUp)
            }}
          />
        )
      })}
    </div>
  )
}

export const PanelDock = memo(PanelDockInner)
