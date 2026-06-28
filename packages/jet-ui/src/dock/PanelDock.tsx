import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import type { Extension } from "@codemirror/state"
import { PanelTree, resolveDropAtPoint, type PanelEvent } from "@jet/panels"
import type { PanelId, TabId } from "@jet/shared"
import type { JetProblem } from "@jet/shared"
import type { TabRegistry, WorkspaceService } from "@jet/workspace"
import type { KeymapContext, JetKeyBinding } from "@jet/workspace"
import type { JetTheme } from "@jet/codemirror"
import { TabRow, computeTabInsertIndex } from "./TabRow.js"
import { DropOverlay } from "./DropOverlay.js"
import { TabBody } from "./TabBody.js"

const DRAG_THRESHOLD = 5
const SPLITTER_HIT_SLOP = 12

export type PanelDockProps = {
  tree: PanelTree
  registry: TabRegistry
  workspace: WorkspaceService
  theme: JetTheme
  focusedPanelId: PanelId | null
  onFocusPanel: (id: PanelId) => void
  onEvent: (event: PanelEvent) => void
  resolveLspClient?: (fileUri: string) => Promise<import("@jet/codemirror").LSPClient | null>
  lspRevision?: number
  executeCommand: (name: string) => Promise<void>
  onOpenFile: (uri: string, path: string) => void
  onOpenFileAt: (uri: string, path: string, line: number, column: number) => void
  onBranchChange?: (branch: string | null) => void
  problems: JetProblem[]
  onOpenProblem: (problem: import("@jet/shared").JetProblem) => void
  keymapBindings: JetKeyBinding[]
  userExtensions: Extension[]
  keymapRevision: number
  keymapContext?: KeymapContext
  onEditorFocusChange?: (focused: boolean) => void
  onEditorSelectionChange?: (line: number, column: number) => void
}

type PendingDrag = {
  tabId: TabId
  sourcePanel: PanelId
  startX: number
  startY: number
}

export function PanelDock(props: PanelDockProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ x: 0, y: 0, width: 800, height: 600 })
  const [dragTab, setDragTab] = useState<{ tabId: TabId; sourcePanel: PanelId } | null>(null)
  const [dragPointer, setDragPointer] = useState<{ x: number; y: number } | null>(null)
  const [dragVector, setDragVector] = useState<{ dx: number; dy: number } | null>(null)
  const pendingDragRef = useRef<PendingDrag | null>(null)
  const dragActiveRef = useRef(false)
  const tabRowRefs = useRef(new Map<number, HTMLDivElement>())

  const measure = useCallback(() => {
    const el = viewportRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setViewport({ x: 0, y: 0, width: r.width, height: r.height })
  }, [])

  useEffect(() => {
    measure()
    const ro = new ResizeObserver(() => measure())
    const el = viewportRef.current
    if (el) ro.observe(el)
    return () => ro.disconnect()
  }, [measure])

  const clearDrag = useCallback(() => {
    pendingDragRef.current = null
    dragActiveRef.current = false
    setDragTab(null)
    setDragPointer(null)
    setDragVector(null)
  }, [])

  const localPointer = useCallback((clientX: number, clientY: number) => {
    const el = viewportRef.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: clientX - r.left, y: clientY - r.top }
  }, [])

  const handleTabPointerDown = useCallback(
    (tabId: TabId, sourcePanel: PanelId, e: ReactPointerEvent) => {
      if (e.button !== 0) return
      if ((e.target as HTMLElement).closest("button")) return
      e.preventDefault()

      const startX = e.clientX
      const startY = e.clientY
      pendingDragRef.current = { tabId, sourcePanel, startX, startY }
      dragActiveRef.current = false

      const onMove = (ev: PointerEvent) => {
        const pending = pendingDragRef.current
        if (!pending) return
        const dx = ev.clientX - pending.startX
        const dy = ev.clientY - pending.startY
        if (!dragActiveRef.current && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
        if (!dragActiveRef.current) {
          dragActiveRef.current = true
          setDragTab({ tabId: pending.tabId, sourcePanel: pending.sourcePanel })
        }
        const local = localPointer(ev.clientX, ev.clientY)
        if (local) {
          setDragPointer(local)
          setDragVector({ dx, dy })
        }
      }

      const onUp = (ev: PointerEvent) => {
        window.removeEventListener("pointermove", onMove)
        window.removeEventListener("pointerup", onUp)
        if (!dragActiveRef.current) {
          pendingDragRef.current = null
          return
        }
        const pending = pendingDragRef.current
        const el = viewportRef.current
        if (pending && el) {
          const r = el.getBoundingClientRect()
          const localX = ev.clientX - r.left
          const localY = ev.clientY - r.top
          const currentViewport = { x: 0, y: 0, width: r.width, height: r.height }
          const dx = ev.clientX - pending.startX
          const dy = ev.clientY - pending.startY
          const hit = resolveDropAtPoint(
            localX,
            localY,
            props.tree.computeRects(currentViewport),
            { dragDx: dx, dragDy: dy },
          )
          if (hit) {
            const samePanel = hit.panelId.id === pending.sourcePanel.id
            if (samePanel && hit.action.kind === "moveToPane") {
              const tabRowEl = tabRowRefs.current.get(pending.sourcePanel.id)
              const insertIndex = tabRowEl
                ? computeTabInsertIndex(tabRowEl, ev.clientX)
                : undefined
              props.onEvent({
                type: "tabMoved",
                tabId: pending.tabId,
                targetPanelId: hit.panelId,
                action: hit.action,
                insertIndex,
              })
            } else if (!samePanel) {
              props.onEvent({
                type: "tabMoved",
                tabId: pending.tabId,
                targetPanelId: hit.panelId,
                action: hit.action,
              })
            }
          }
        }
        clearDrag()
      }

      window.addEventListener("pointermove", onMove)
      window.addEventListener("pointerup", onUp)
    },
    [clearDrag, localPointer, props.onEvent, props.tree],
  )

  const rects = props.tree.computeRects(viewport)
  const splitters = props.tree.splitterHits(viewport)

  return (
    <div ref={viewportRef} className="relative h-full w-full overflow-hidden" onMouseUp={measure}>
      <div className="absolute inset-0">
        {[...rects.entries()].map(([panelNum, rect]) => {
          const panelId = { id: panelNum }
          const leaf = props.tree.getLeaf(panelId)
          if (!leaf) return null
          const activeTabId = leaf.group.tabs[leaf.group.active]
          const activeKind = activeTabId ? props.registry.get(activeTabId) : null
          const autoFocusEditor =
            props.focusedPanelId?.id === panelNum && activeKind?.kind === "editor"
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
              <TabRow
                panelId={panelId}
                group={leaf.group}
                registry={props.registry}
                focused={props.focusedPanelId?.id === panelNum}
                onSelect={tabId =>
                  props.onEvent({ type: "tabSelect", panelId, tabId })
                }
                onClose={tabId => props.onEvent({ type: "tabClose", tabId })}
                onClosePanel={() => props.onEvent({ type: "panelClose", panelId })}
                onTabPointerDown={handleTabPointerDown}
                draggingTabId={dragTab?.tabId.id ?? null}
                tabRowRef={el => {
                  if (el) tabRowRefs.current.set(panelNum, el)
                  else tabRowRefs.current.delete(panelNum)
                }}
              />
              <div className="min-h-0 flex-1">
                {activeTabId && (
                  <TabBody
                    tabId={activeTabId}
                    registry={props.registry}
                    workspace={props.workspace}
                    theme={props.theme}
                    resolveLspClient={props.resolveLspClient}
                    lspRevision={props.lspRevision}
                    executeCommand={props.executeCommand}
                    onOpenFile={props.onOpenFile}
                    onOpenFileAt={props.onOpenFileAt}
                    onBranchChange={props.onBranchChange}
                    problems={props.problems}
                    onOpenProblem={props.onOpenProblem}
                    keymapBindings={props.keymapBindings}
                    userExtensions={props.userExtensions}
                    keymapContext={props.keymapContext}
                    onEditorFocusChange={props.onEditorFocusChange}
                    onEditorSelectionChange={props.onEditorSelectionChange}
                    autoFocus={autoFocusEditor}
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
              className="absolute z-20 flex items-center justify-center"
              style={{
                left: slopX,
                top: slopY,
                width: slopW,
                height: slopH,
                cursor: horizontal ? "col-resize" : "row-resize",
                touchAction: "none",
              }}
              onPointerDown={e => {
                e.preventDefault()
                e.currentTarget.setPointerCapture(e.pointerId)
                let lastPos = horizontal ? e.clientX : e.clientY
                const onMove = (ev: PointerEvent) => {
                  const pos = horizontal ? ev.clientX : ev.clientY
                  const delta = pos - lastPos
                  lastPos = pos
                  if (delta === 0) return
                  props.onEvent({
                    type: "splitResized",
                    path: hit.path,
                    splitterIndex: hit.index,
                    deltaPx: delta,
                    viewport,
                  })
                }
                const onUp = () => {
                  e.currentTarget.releasePointerCapture(e.pointerId)
                  e.currentTarget.removeEventListener("pointermove", onMove)
                  e.currentTarget.removeEventListener("pointerup", onUp)
                  e.currentTarget.removeEventListener("pointercancel", onUp)
                  measure()
                }
                e.currentTarget.addEventListener("pointermove", onMove)
                e.currentTarget.addEventListener("pointerup", onUp)
                e.currentTarget.addEventListener("pointercancel", onUp)
              }}
            >
              <div
                className="bg-[var(--jet-border)] hover:bg-[var(--jet-accent)]"
                style={{
                  width: horizontal ? hit.rect.width : "100%",
                  height: horizontal ? "100%" : hit.rect.height,
                }}
              />
            </div>
          )
        })}

        {dragTab && (
          <DropOverlay
            tree={props.tree}
            viewport={viewport}
            dragTab={dragTab}
            pointer={dragPointer}
            dragDx={dragVector?.dx}
            dragDy={dragVector?.dy}
          />
        )}
      </div>
    </div>
  )
}
