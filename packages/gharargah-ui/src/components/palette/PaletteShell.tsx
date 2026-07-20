import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js"
import { COMMAND_SHELL_CLASS } from "@/lib/command-shell.js"
import { Lister, type ListerNode } from "@/lister/index.js"
import { cn } from "@/lib/utils.js"

export interface PaletteShellItem<T> {
  key: string
  value: string
  data: T
}

export interface PaletteShellProps<T> {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  placeholder: string
  disabled?: boolean
  query?: string
  onQueryChange?: (query: string) => void
  items: PaletteShellItem<T>[]
  onSelect: (item: T, query: string) => void
  renderItem: (item: T, query: string) => ReactNode
  emptyLabel: ReactNode
  statusRow?: ReactNode
  shouldFilter?: boolean
  size?: "picker" | "wide"
  contentClassName?: string
  itemClassName?: string
  itemStyle?: (item: T) => CSSProperties | undefined
}

export function PaletteShell<T>({
  open,
  onOpenChange,
  title,
  description,
  placeholder,
  disabled,
  query: queryProp,
  onQueryChange,
  items,
  onSelect,
  renderItem,
  emptyLabel,
  statusRow,
  shouldFilter,
  size = "picker",
  contentClassName,
  itemClassName,
  itemStyle,
}: PaletteShellProps<T>) {
  const isControlled = queryProp !== undefined
  const [uncontrolledQuery, setUncontrolledQuery] = useState("")
  const query = isControlled ? queryProp : uncontrolledQuery
  const setQuery = (next: string) => {
    if (!isControlled) setUncontrolledQuery(next)
    onQueryChange?.(next)
  }

  useEffect(() => {
    if (!open && !isControlled) setUncontrolledQuery("")
  }, [open, isControlled])

  const filterMode = shouldFilter === false ? "external" : "local"

  const listerItems = useMemo<ListerNode<T>[]>(
    () =>
      items.map(it => ({
        id: it.key,
        searchText: it.value,
        data: it.data,
      })),
    [items],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader className="sr-only">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogContent
        motion="instant"
        size={size}
        className={[
          "max-h-[calc(100dvh-2rem)] overflow-hidden border-border/70 bg-popover p-0 shadow-2xl shadow-black/25",
          contentClassName,
        ]
          .filter(Boolean)
          .join(" ")}
        showCloseButton={false}
      >
        <div className={cn(COMMAND_SHELL_CLASS, "flex min-h-0 flex-col")}>
          <Lister
            listId="gharargah:palette"
            mode="flat"
            flatVariant="palette"
            showInput
            placeholder={placeholder}
            inputDisabled={disabled}
            query={query}
            onQueryChange={setQuery}
            filter={filterMode}
            requireQueryForSelection
            items={listerItems}
            itemClassName={cn("px-2 py-3", itemClassName)}
            itemStyle={node => itemStyle?.(node.data)}
            estimateSize={() => 48}
            betweenInputAndList={statusRow}
            listClassName="min-h-0 max-h-[min(var(--gharargah-overlay-list-max),calc(100dvh-5rem))] pb-1"
            className="min-h-0"
            emptyState={
              <div data-slot="command-empty" className="py-6 text-center text-sm">
                {emptyLabel}
              </div>
            }
            onActivate={node => {
              onSelect(node.data, query)
              onOpenChange(false)
            }}
            render={(node, ctx) => renderItem(node.data, ctx.query)}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
