import type { ListItem } from "@jet/workspace"
import { useEffect, useRef } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { ListRow } from "@/components/ListRow.js"
import { jetScrollFadeClass } from "@/motion/tokens.js"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty.js"
import { registerListPanel } from "@/lib/list-registry.js"
import { cn } from "@/lib/utils.js"

export type LocationListProps = {
  listId: string
  items: ListItem[]
  onOpenItem: (item: ListItem) => void
  loading?: boolean
  emptyTitle?: string
  emptyDescription?: string
  header?: React.ReactNode
}

const OVERSCAN = 8

function readRowHeightPx(): number {
  if (typeof document === "undefined") return 24
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--jet-location-row-height")
    .trim()
  const n = parseFloat(raw)
  return Number.isFinite(n) && n > 0 ? n : 24
}

export function LocationList({
  listId,
  items,
  onOpenItem,
  loading = false,
  emptyTitle = "No results",
  emptyDescription = "Nothing to show in this list.",
  header,
}: LocationListProps) {
  const scrollRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    return registerListPanel(listId, scrollRef.current)
  }, [listId, items.length])

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: readRowHeightPx,
    overscan: OVERSCAN,
  })

  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col bg-background text-foreground"
      data-jet-list-panel={listId}
      data-jet-location-list
    >
      {header}
      <ul
        ref={scrollRef}
        className={cn("m-0 min-h-0 flex-1 list-none overflow-auto bg-background p-1", jetScrollFadeClass)}
      >
        {items.length === 0 ? (
          loading ? null : (
            <li className="p-1">
              <Empty className="border-0 py-4">
                <EmptyHeader>
                  <EmptyTitle className="text-sm">{emptyTitle}</EmptyTitle>
                  <EmptyDescription className="text-xs">{emptyDescription}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            </li>
          )
        ) : (
          <li
            style={{
              height: virtualizer.getTotalSize(),
              width: "100%",
              position: "relative",
              display: "block",
            }}
          >
            {virtualizer.getVirtualItems().map(v => {
              const item = items[v.index]!
              return (
                <div
                  key={item.id}
                  data-jet-list-row
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: v.size,
                    transform: `translateY(${v.start}px)`,
                  }}
                >
                  <ListRow
                    data-jet-list-item
                    className="w-full min-w-0 px-2 py-0.5"
                    onClick={() => onOpenItem(item)}
                  >
                    <span
                      data-slot="row-label"
                      className="truncate text-sm font-medium text-foreground group-hover:text-accent-foreground"
                    >
                      {item.label}
                    </span>
                    <span
                      data-slot="row-detail"
                      className="truncate font-mono text-xs tabular-nums text-muted-foreground group-hover:text-muted-foreground"
                    >
                      {item.path}:{item.line}:{item.column}
                      {item.detail ? ` · ${item.detail}` : ""}
                    </span>
                  </ListRow>
                </div>
              )
            })}
          </li>
        )}
      </ul>
    </div>
  )
}
