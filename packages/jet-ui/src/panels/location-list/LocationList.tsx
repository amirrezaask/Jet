import type { ListItem } from "@jet/workspace"
import { useEffect, useRef } from "react"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty.js"
import { registerListPanel } from "@/lib/list-registry.js"

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

  useEffect(() => {
    return registerListPanel(listId, scrollRef.current)
  }, [listId, items.length])

  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col text-foreground"
      data-jet-list-panel={listId}
      data-jet-location-list
    >
      {header}
      <ul ref={scrollRef} className="jet-location-list-scroll min-h-0 flex-1 overflow-auto">
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
          items.map(item => (
            <li key={item.id} className="jet-location-list-item">
              <button
                type="button"
                data-jet-list-item
                className="jet-location-list-row"
                onClick={() => onOpenItem(item)}
              >
                <span className="jet-location-list-row-label" data-slot="row-label">
                  {item.label}
                </span>
                <span className="jet-location-list-row-detail jet-mono-data" data-slot="row-detail">
                  {item.path}:{item.line}:{item.column}
                  {item.detail ? ` · ${item.detail}` : ""}
                </span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}
