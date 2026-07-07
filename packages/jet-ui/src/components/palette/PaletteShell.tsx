import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react"
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command.js"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js"
import { COMMAND_NO_SELECTION, COMMAND_SHELL_CLASS } from "@/lib/command-shell.js"

type MaxWidth = "xs" | "sm" | "md" | "lg" | "xl"

const MAX_WIDTH: Record<MaxWidth, string> = {
  xs: "max-w-md",
  sm: "max-w-[32rem]",
  md: "max-w-[34rem]",
  lg: "max-w-[40rem]",
  xl: "max-w-[42rem]",
}

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
  maxWidth?: MaxWidth
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
  maxWidth = "md",
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

  const [selectedValue, setSelectedValue] = useState(COMMAND_NO_SELECTION)

  useEffect(() => {
    if (!open) {
      if (!isControlled) setUncontrolledQuery("")
      setSelectedValue(COMMAND_NO_SELECTION)
    }
  }, [open, isControlled])

  useEffect(() => {
    if (query.trim() === "") {
      setSelectedValue(COMMAND_NO_SELECTION)
      return
    }
    if (items.length === 0) return
    if (!items.some(it => it.value === selectedValue)) {
      setSelectedValue(items[0]!.value)
    }
  }, [items, query, selectedValue])

  const valueMap = useMemo(() => {
    const m = new Map<string, T>()
    for (const it of items) m.set(it.value, it.data)
    return m
  }, [items])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader className="sr-only">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogContent
        className={[MAX_WIDTH[maxWidth], "overflow-hidden p-0", contentClassName]
          .filter(Boolean)
          .join(" ")}
        showCloseButton={false}
      >
        <Command
          className={COMMAND_SHELL_CLASS}
          shouldFilter={shouldFilter}
          value={selectedValue}
          onValueChange={value => {
            if (query.trim() === "") {
              setSelectedValue(COMMAND_NO_SELECTION)
              return
            }
            setSelectedValue(value)
          }}
        >
          <CommandInput
            placeholder={placeholder}
            value={query}
            onValueChange={setQuery}
            disabled={disabled}
          />
          {statusRow}
          <CommandList className="max-h-[var(--jet-overlay-list-max)]">
            <CommandEmpty>{emptyLabel}</CommandEmpty>
            <CommandItem value={COMMAND_NO_SELECTION} className="hidden" aria-hidden />
            {items.map(it => (
              <CommandItem
                key={it.key}
                value={it.value}
                className={itemClassName}
                style={itemStyle?.(it.data)}
                onSelect={() => {
                  const data = valueMap.get(it.value) ?? it.data
                  onSelect(data, query)
                  onOpenChange(false)
                }}
              >
                {renderItem(it.data, query)}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
