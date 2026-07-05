import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from "react"
import {
  PanelLeftIcon,
  PanelRightIcon,
  PanelTopIcon,
  PanelBottomIcon,
  SquareIcon,
} from "lucide-react"
import type { DropAction, PanelId } from "@jet/shared"
import { cn } from "@/lib/utils.js"
import { TAB_DRAG_MIME, usePanelDrag } from "./PanelDragContext.js"
import {
  computeDropSites,
  hitTestSites,
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
    case "center": return <SquareIcon className={cls} />
    case "left":   return <PanelLeftIcon className={cls} />
    case "right":  return <PanelRightIcon className={cls} />
    case "top":    return <PanelTopIcon className={cls} />
    case "bottom": return <PanelBottomIcon className={cls} />
  }
}

function previewStyle(r: SiteRect): React.CSSProperties {
  return { position: "absolute", left: r.x, top: r.y, width: r.w, height: r.h }
}

export function PanelDropOverlay({
  panelId,
  onTabDrop,
}: {
  panelId: PanelId
  onTabDrop: (
    source: PanelId,
    sourceTabId: string,
    target: PanelId,
    action: DropAction,
  ) => void
}) {
  const drag = usePanelDrag()
  const containerRef = useRef<HTMLDivElement>(null)
  const size = useElementSize(containerRef)
  const fontSize = useFontSize(containerRef)

  const [hot, setHot] = useState<DropSiteKind | null>(null)
  const [entered, setEntered] = useState(false)
  const [previewMounted, setPreviewMounted] = useState(false)

  const tabDrag = drag.tabSource
  const active = tabDrag != null
  const samePanel = tabDrag?.panelId.id === panelId.id

  const sites = useMemo(
    () => computeDropSites(size.w, size.h, fontSize),
    [size.w, size.h, fontSize],
  )
  const effectiveSites = samePanel ? sites.filter(s => s.id !== "center") : sites
  const hotSite: DropSite | null = hot ? (effectiveSites.find(s => s.id === hot) ?? null) : null

  useLayoutEffect(() => {
    if (hot) setPreviewMounted(true)
    else setPreviewMounted(false)
  }, [hot])

  // Reset when drag ends
  useEffect(() => {
    if (!tabDrag) {
      setHot(null)
      setEntered(false)
      setPreviewMounted(false)
    }
  }, [tabDrag])

  const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes(TAB_DRAG_MIME)) return
    e.preventDefault()
    setEntered(true)
  }

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes(TAB_DRAG_MIME)) return
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const site = hitTestSites(mx, my, effectiveSites)
    setHot(site?.id ?? null)
  }

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
    setHot(null)
    setEntered(false)
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes(TAB_DRAG_MIME)) return
    e.preventDefault()

    const action: DropAction | null = hot
      ? siteToAction(hot)
      : samePanel
        ? null
        : { kind: "moveToPane" }

    setHot(null)
    setEntered(false)
    drag.endTab()

    if (action && tabDrag) {
      onTabDrop(tabDrag.panelId, tabDrag.tabId, panelId, action)
    }
  }

  return (
    <div
      ref={containerRef}
      style={{ position: "absolute", inset: 0, zIndex: 40, pointerEvents: active ? undefined : "none" }}
      // Always mounted so ResizeObserver keeps measuring; pointer-events only when drag active
      onDragEnter={active ? handleDragEnter : undefined}
      onDragOver={active ? handleDragOver : undefined}
      onDragLeave={active ? handleDragLeave : undefined}
      onDrop={active ? handleDrop : undefined}
      data-jet-panel-drop-overlay
    >
      {active && (
        <>
          {/* Animated future-split preview rect */}
          {hotSite && previewMounted && (
            <div
              className="pointer-events-none rounded-sm border border-primary/60 bg-primary/15 transition-[left,top,width,height,opacity] duration-150 ease-out"
              style={previewStyle(hotSite.preview)}
            />
          )}

          {/* 5 drop-site squares */}
          {effectiveSites.map(site => (
            <div
              key={site.id}
              data-drop-site={site.id}
              className={cn(
                "pointer-events-none absolute flex items-center justify-center rounded-md border shadow-sm transition-all duration-150 ease-out",
                entered ? "scale-100 opacity-100" : "scale-90 opacity-0",
                hot === site.id
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
          ))}
        </>
      )}
    </div>
  )
}
