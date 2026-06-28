import { useCallback, useEffect, useRef, useState } from "react"
import { motion } from "motion/react"
import { PanelTree, dropSitesForPanel, type PanelEvent } from "@jet/panels"
import type { PanelId, TabId } from "@jet/shared"
import type { TabRegistry, WorkspaceService } from "@jet/workspace"
import type { JetKeyBinding } from "@jet/workspace"
import type { JetTheme } from "@jet/codemirror"
import { TabRow } from "./TabRow.js"
import { DropOverlay } from "./DropOverlay.js"
import { TabBody } from "./TabBody.js"
import { jetMotion } from "../motion/tokens.js"

export type PanelDockProps = {
  tree: PanelTree
  registry: TabRegistry
  workspace: WorkspaceService
  theme: JetTheme
  focusedPanelId: PanelId | null
  onFocusPanel: (id: PanelId) => void
  onEvent: (event: PanelEvent) => void
  lspTransportUrl?: string | null
  executeCommand: (name: string) => Promise<void>
  onOpenFile: (uri: string, path: string) => void
  keymapBindings: JetKeyBinding[]
}

export function PanelDock(props: PanelDockProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ x: 0, y: 0, width: 800, height: 600 })
  const [dragTab, setDragTab] = useState<{ tabId: TabId; sourcePanel: PanelId } | null>(null)

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

  const rects = props.tree.computeRects(viewport)
  const splitters = props.tree.splitterHits(viewport)

  return (
    <div ref={viewportRef} className="relative h-full w-full overflow-hidden" onMouseUp={measure}>
      <div className="absolute inset-0">
        {[...rects.entries()].map(([panelNum, rect]) => {
          const panelId = { id: panelNum }
          const leaf = props.tree.getLeaf(panelId)
          if (!leaf) return null
          return (
            <motion.div
              key={panelNum}
              layout
              transition={jetMotion.fastSpring}
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
                onDragStart={(tabId, sourcePanel) => setDragTab({ tabId, sourcePanel })}
                onDragEnd={() => setDragTab(null)}
              />
              <div className="min-h-0 flex-1">
                {leaf.group.tabs[leaf.group.active] && (
                  <TabBody
                    tabId={leaf.group.tabs[leaf.group.active]!}
                    registry={props.registry}
                    workspace={props.workspace}
                    theme={props.theme}
                    lspTransportUrl={props.lspTransportUrl}
                    executeCommand={props.executeCommand}
                    onOpenFile={props.onOpenFile}
                    keymapBindings={props.keymapBindings}
                  />
                )}
              </div>
            </motion.div>
          )
        })}

        {splitters.map((hit, i) => (
          <div
            key={i}
            className="absolute z-20 bg-[var(--jet-border)] hover:bg-[var(--jet-accent)]"
            style={{
              left: hit.rect.x,
              top: hit.rect.y,
              width: hit.rect.width,
              height: hit.rect.height,
              cursor: hit.axis === "horizontal" ? "col-resize" : "row-resize",
            }}
            onMouseDown={e => {
              e.preventDefault()
              const start = hit.axis === "horizontal" ? e.clientX : e.clientY
              const onMove = (ev: MouseEvent) => {
                const delta = (hit.axis === "horizontal" ? ev.clientX : ev.clientY) - start
                props.onEvent({
                  type: "splitResized",
                  path: hit.path,
                  splitterIndex: hit.index,
                  deltaPx: delta,
                })
              }
              const onUp = () => {
                window.removeEventListener("mousemove", onMove)
                window.removeEventListener("mouseup", onUp)
                measure()
              }
              window.addEventListener("mousemove", onMove)
              window.addEventListener("mouseup", onUp)
            }}
          />
        ))}

        {dragTab && (
          <DropOverlay
            tree={props.tree}
            viewport={viewport}
            dragTab={dragTab}
            onDrop={(targetPanel, action, insertIndex) => {
              props.onEvent({
                type: "tabMoved",
                tabId: dragTab.tabId,
                targetPanelId: targetPanel,
                action,
                insertIndex,
              })
              setDragTab(null)
            }}
          />
        )}
      </div>
    </div>
  )
}
