import { PanelTree } from "@jet/panels"
import { dropSitesForPanel } from "@jet/panels"
import type { DropAction, PanelId, Rect, TabId } from "@jet/shared"

export function DropOverlay({
  tree,
  viewport,
  dragTab,
  onDrop,
}: {
  tree: PanelTree
  viewport: Rect
  dragTab: { tabId: TabId; sourcePanel: PanelId }
  onDrop: (panel: PanelId, action: DropAction, insertIndex?: number) => void
}) {
  const rects = tree.computeRects(viewport)

  return (
    <div className="pointer-events-none absolute inset-0 z-40">
      {[...rects.entries()].map(([panelNum, rect]) => {
        const panelId = { id: panelNum }
        const sites = dropSitesForPanel(rect, panelId)
        return sites.map((site, i) => (
          <button
            key={`${panelNum}-${i}`}
            type="button"
            className="pointer-events-auto absolute border-2 border-[var(--jet-accent)] bg-[var(--jet-accent)]/10"
            style={{
              left: site.rect.x,
              top: site.rect.y,
              width: site.rect.width,
              height: site.rect.height,
            }}
            onMouseUp={() => onDrop(panelId, site.action)}
          />
        ))
      })}
    </div>
  )
}
