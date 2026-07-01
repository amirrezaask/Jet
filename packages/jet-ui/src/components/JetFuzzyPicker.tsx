import { useEffect, useState, type ReactNode } from "react"
import { Command as CommandPrimitive } from "cmdk"
import { JetCmdkItem } from "./JetCmdkItem.js"
import { JetOverlay } from "./JetOverlay.js"

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
    if (!items.some(item => item.value === selectedValue)) {
      setSelectedValue(items[0]!.value)
    }
  }, [items, selectedValue])

  return (
    <JetOverlay open={open} onOpenChange={onOpenChange} ariaLabel={ariaLabel} maxWidth={maxWidth}>
      <CommandPrimitive
        className="overflow-hidden rounded-sm border border-[var(--jet-border)] bg-[var(--jet-panel-raised)] shadow-2xl"
        shouldFilter={shouldFilter}
        value={selectedValue}
        onValueChange={setSelectedValue}
      >
        <CommandPrimitive.Input
          placeholder={placeholder}
          value={query}
          onValueChange={setQuery}
          className="jet-input w-full border-b border-[var(--jet-border)] bg-transparent px-3 py-2 text-[length:var(--jet-fs-base)]"
          autoFocus
        />
        <CommandPrimitive.List className="overflow-auto p-1" style={{ maxHeight: maxListHeight }}>
          <CommandPrimitive.Empty className="px-3 py-2 text-[length:var(--jet-fs-base)] text-[var(--jet-text-muted)]">
            {emptyMessage}
          </CommandPrimitive.Empty>
          {items.map(item => (
            <JetCmdkItem
              key={item.value}
              value={item.value}
              onSelect={() => {
                item.onSelect()
                onOpenChange(false)
              }}
            >
              {item.label}
            </JetCmdkItem>
          ))}
        </CommandPrimitive.List>
      </CommandPrimitive>
    </JetOverlay>
  )
}
