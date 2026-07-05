import type { ListItem } from "@jet/workspace"
import { useEffect, useRef } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty.js"
import { ListRow } from "@/components/ListRow.js"
import { registerListPanel } from "@/lib/list-registry.js"

const ROW_HEIGHT_PX = 40

export type LocationListProps = {
  listId: string
  items: ListItem[]
  onOpenItem: (item: ListItem) => void
  loading?: boolean
  emptyTitle?: string
  emptyDescription?: string
  header?: React.ReactNode
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
  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT_PX,
    overscan: 8,
  })

  useEffect(() => {
    return registerListPanel(listId, scrollRef.current)
  }, [listId, items.length])

  useEffect(() => {
    rowVirtualizer.measure()
  }, [items.length, rowVirtualizer])

  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col text-foreground"
      data-jet-list-panel={listId}
    >
      {header}
      <ul ref={scrollRef} className="min-h-0 flex-1 overflow-auto p-1">
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
          <li style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
            {rowVirtualizer.getVirtualItems().map(virtualRow => {
              const item = items[virtualRow.index]!
              return (
                <div
                  key={item.id}
                  data-index={virtualRow.index}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: ROW_HEIGHT_PX,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <ListRow
                    data-jet-list-item
                    className="w-full min-w-0"
                    onClick={() => onOpenItem(item)}
                  >
                    <span data-slot="row-label">{item.label}</span>
                    <span data-slot="row-detail" className="jet-mono-data">
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
