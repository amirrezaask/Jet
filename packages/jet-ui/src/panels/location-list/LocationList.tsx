import type { ListItem } from "@jet/workspace"
import { ListRow } from "@/components/ListRow.js"
import { jetScrollFadeClass } from "@/motion/tokens.js"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty.js"
import { Lister, type ListerNode } from "@/lister/index.js"
import { cn } from "@/lib/utils.js"
import { useMemo } from "react"
import { readLocationRowHeight } from "@/lister/measure.js"

export type LocationListProps = {
  listId: string
  items: ListItem[]
  onOpenItem: (item: ListItem) => void
  loading?: boolean
  emptyTitle?: string
  emptyDescription?: string
  header?: React.ReactNode
  feed?: string
}

export function LocationList({
  listId,
  items,
  onOpenItem,
  loading = false,
  emptyTitle = "No results",
  emptyDescription = "Nothing to show in this list.",
  header,
  feed,
}: LocationListProps) {
  const listerItems = useMemo<ListerNode<ListItem>[]>(
    () =>
      items.map(item => ({
        id: item.id,
        searchText: `${item.label} ${item.path} ${item.detail ?? ""} ${item.line}:${item.column}`,
        data: item,
      })),
    [items],
  )

  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col bg-background text-foreground"
      data-jet-list-panel={listId}
      data-jet-location-list
      data-jet-list-feed={feed}
    >
      {header}
      <Lister
        listId={listId}
        mode="flat"
        flatVariant="plain"
        filter="local"
        showInput={false}
        items={listerItems}
        estimateSize={() => readLocationRowHeight()}
        listClassName={cn(
          "m-0 min-h-0 flex-1 list-none overflow-auto bg-background p-1",
          jetScrollFadeClass,
        )}
        className="min-h-0 flex-1"
        emptyState={
          loading ? null : (
            <div className="p-1">
              <Empty className="border-0 py-4">
                <EmptyHeader>
                  <EmptyTitle className="text-sm">{emptyTitle}</EmptyTitle>
                  <EmptyDescription className="text-xs">{emptyDescription}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            </div>
          )
        }
        onActivate={node => onOpenItem(node.data)}
        render={(node, ctx) => (
          <ListRow
            data-jet-list-item
            isActive={ctx.selected}
            className="h-full w-full min-w-0 px-2 py-0.5"
            onClick={() => onOpenItem(node.data)}
          >
            <span
              data-slot="row-label"
              className="truncate text-sm font-medium text-foreground group-hover:text-accent-foreground"
            >
              {node.data.label}
            </span>
            <span
              data-slot="row-detail"
              className="truncate font-mono text-xs tabular-nums text-muted-foreground group-hover:text-muted-foreground"
            >
              {node.data.path}:{node.data.line}:{node.data.column}
              {node.data.detail ? ` · ${node.data.detail}` : ""}
            </span>
          </ListRow>
        )}
      />
    </div>
  )
}
