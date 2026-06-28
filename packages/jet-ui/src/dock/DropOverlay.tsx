import { PanelTree, dropSitesForPanel, dropSiteMatchesAction, resolveDropAtPoint } from "@jet/panels"
import type { PanelId, Rect, TabId } from "@jet/shared"

export function DropOverlay({
  tree,
  viewport,
  pointer,
  dragDx,
  dragDy,
}: {
  tree: PanelTree
  viewport: Rect
  dragTab: { tabId: TabId; sourcePanel: PanelId }
  pointer: { x: number; y: number } | null
  dragDx?: number
  dragDy?: number
}) {
  const rects = tree.computeRects(viewport)
  const activeHit = pointer
    ? resolveDropAtPoint(pointer.x, pointer.y, rects, { dragDx, dragDy })
    : null

  return (
    <div className="pointer-events-none absolute inset-0 z-40">
      {[...rects.entries()].map(([panelNum, rect]) => {
        const panelId = { id: panelNum }
        const sites = dropSitesForPanel(rect, panelId)
        return sites.map((site, i) => {
          const active = activeHit && dropSiteMatchesAction(site, activeHit)
          return (
            <div
              key={`${panelNum}-${i}`}
              className={
                active
                  ? "absolute border-2 border-[var(--jet-accent)] bg-[var(--jet-accent)]/25"
                  : "absolute border-2 border-transparent"
              }
              style={{
                left: site.rect.x,
                top: site.rect.y,
                width: site.rect.width,
                height: site.rect.height,
              }}
            />
          )
        })
      })}
    </div>
  )
}
