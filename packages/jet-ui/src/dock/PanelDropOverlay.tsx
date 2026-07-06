import { useEffect, useMemo, useRef, useState } from "react"
import { useDroppable } from "@dnd-kit/core"
import {
  PanelLeftIcon,
  PanelRightIcon,
  PanelTopIcon,
  PanelBottomIcon,
  SquareIcon,
} from "lucide-react"
import type { PanelId } from "@jet/shared"
import { cn } from "@/lib/utils.js"
import { usePanelDrag } from "./PanelDragContext.js"
import { useDropHot } from "./TabDndRoot.js"
import { dropDndId } from "./tab-dnd-types.js"
import {
  computeDropSites,
  siteToAction,
  type DropSite,
  type DropSiteKind,
  type SiteRect,
} from "./panel-drop-zones.js"

function useElementSize(ref: React.RefObject<HTMLDivElement | null>): { w: number; h: number } {
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const entry = entries[0]
      if (!entry) return
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height })
    })
    ro.observe(el)
    const r = el.getBoundingClientRect()
    setSize({ w: r.width, h: r.height })
    return () => ro.disconnect()
  }, [ref])
  return size
}

function useFontSize(ref: React.RefObject<HTMLDivElement | null>): number {
  const [fs, setFs] = useState(13)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const v = parseFloat(getComputedStyle(el).fontSize)
    if (!isNaN(v) && v > 0) setFs(v)
  }, [ref])
  return fs
}

function siteIcon(kind: DropSiteKind) {
  const cls = "size-3.5"
  switch (kind) {
    case "center":
      return <SquareIcon className={cls} />
    case "left":
      return <PanelLeftIcon className={cls} />
    case "right":
      return <PanelRightIcon className={cls} />
    case "top":
      return <PanelTopIcon className={cls} />
    case "bottom":
      return <PanelBottomIcon className={cls} />
  }
}

function previewStyle(r: SiteRect): React.CSSProperties {
  return { position: "absolute", left: r.x, top: r.y, width: r.w, height: r.h }
}

function DropSiteTarget({
  panelId,
  site,
  entered,
  hot,
}: {
  panelId: PanelId
  site: DropSite
  entered: boolean
  hot: boolean
}) {
  const { setNodeRef } = useDroppable({
    id: dropDndId(panelId, site.id),
    data: { type: "split", panelId, zone: site.id },
  })

  return (
    <div
      ref={setNodeRef}
      data-drop-site={site.id}
      className={cn(
        "pointer-events-auto absolute flex items-center justify-center rounded-md border shadow-sm transition-all duration-[var(--jet-motion-fast)] ease-out",
        entered ? "scale-100 opacity-100" : "scale-90 opacity-0",
        hot
          ? "border-primary bg-primary/20 text-primary scale-105"
          : "border-border/70 bg-muted/70 text-muted-foreground backdrop-blur-sm",
      )}
      style={{
        left: site.rect.x,
        top: site.rect.y,
        width: site.rect.w,
        height: site.rect.h,
      }}
    >
      {siteIcon(site.id)}
    </div>
  )
}

export function PanelDropOverlay({
  panelId,
}: {
  panelId: PanelId
  /** @deprecated drops handled by TabDndRoot */
  onTabDrop?: unknown
}) {
  const drag = usePanelDrag()
  const dropHot = useDropHot()
  const containerRef = useRef<HTMLDivElement>(null)
  const size = useElementSize(containerRef)
  const fontSize = useFontSize(containerRef)

  const tabDrag = drag.tabSource
  const active = tabDrag != null
  const samePanel = tabDrag?.panelId.id === panelId.id

  const sites = useMemo(
    () => computeDropSites(size.w, size.h, fontSize),
    [size.w, size.h, fontSize],
  )
  const effectiveSites = samePanel ? sites.filter(s => s.id !== "center") : sites

  const hotSite: DropSite | null =
    dropHot && dropHot.panelId.id === panelId.id
      ? (effectiveSites.find(s => s.id === dropHot.zone) ?? null)
      : null

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    if (active && effectiveSites.length > 0) {
      el.dataset.jetDropPanel = String(panelId.id)
      el.dataset.jetDropSites = JSON.stringify(effectiveSites)
    } else {
      delete el.dataset.jetDropPanel
      delete el.dataset.jetDropSites
    }
  }, [active, effectiveSites, panelId.id])

  return (
    <div
      ref={containerRef}
      className={cn("absolute inset-0 z-40", !active && "pointer-events-none")}
      data-jet-panel-drop-overlay
    >
      {active && (
        <>
          {hotSite && (
            <div
              className="pointer-events-none rounded-sm border border-primary/60 bg-primary/15 transition-[left,top,width,height,opacity] duration-[var(--jet-motion-fast)] ease-out"
              style={previewStyle(hotSite.preview)}
            />
          )}

          {effectiveSites.map(site => (
            <DropSiteTarget
              key={site.id}
              panelId={panelId}
              site={site}
              entered={active}
              hot={hotSite?.id === site.id}
            />
          ))}
        </>
      )}
    </div>
  )
}

// Keep siteToAction exported for tests
void siteToAction
