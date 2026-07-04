import { useEffect, useState, type ReactNode } from "react"
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
  DialogTitle,
} from "@/components/ui/dialog.js"

export type JetFuzzyPickerItem = {
  value: string
  label: ReactNode
  onSelect: () => void
}

export function JetFuzzyPicker({
  open,
  onOpenChange,
  ariaLabel,
  placeholder,
  emptyMessage = "No results.",
  maxWidth = "32rem",
  maxListHeight = "18rem",
  items,
  shouldFilter = true,
  query: controlledQuery,
  onQueryChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  ariaLabel: string
  placeholder: string
  emptyMessage?: string
  maxWidth?: string
  maxListHeight?: string
  items: JetFuzzyPickerItem[]
  shouldFilter?: boolean
  query?: string
  onQueryChange?: (query: string) => void
}) {
  const [internalQuery, setInternalQuery] = useState("")
  const [selectedValue, setSelectedValue] = useState("")
  const query = controlledQuery ?? internalQuery
  const setQuery = onQueryChange ?? setInternalQuery

  useEffect(() => {
    if (!open) {
      setQuery("")
      setSelectedValue("")
    }
  }, [open, setQuery])

  useEffect(() => {
    if (items.length === 0) {
      setSelectedValue("")
      return
    }
    if (query.trim() === "") {
      setSelectedValue("")
      return
    }
    if (!items.some(item => item.value === selectedValue)) {
      setSelectedValue(items[0]!.value)
    }
  }, [items, selectedValue, query])

  if (!open) return null

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        className="jet-palette overflow-hidden p-0"
        style={{ maxWidth }}
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">{ariaLabel}</DialogTitle>
        <DialogDescription className="sr-only">{placeholder}</DialogDescription>
        <Command
          shouldFilter={shouldFilter}
          value={selectedValue}
          onValueChange={setSelectedValue}
        >
          <CommandInput placeholder={placeholder} value={query} onValueChange={setQuery} />
          <CommandList style={{ maxHeight: maxListHeight }}>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            {items.map(item => (
              <CommandItem
                key={item.value}
                value={item.value}
                onSelect={() => {
                  item.onSelect()
                  onOpenChange(false)
                }}
              >
                {item.label}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
