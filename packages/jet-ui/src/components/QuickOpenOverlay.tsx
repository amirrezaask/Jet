import { useDeferredValue, useEffect, useMemo, useState } from "react"
import { fuzzyMatchFiles } from "@jet/workspace"
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

export function QuickOpenOverlay({
  open,
  onOpenChange,
  files,
  onSelect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  files: string[]
  onSelect: (path: string) => void
}) {
  const [query, setQuery] = useState("")
  const [selectedValue, setSelectedValue] = useState(COMMAND_NO_SELECTION)
  const deferredQuery = useDeferredValue(query)

  useEffect(() => {
    if (!open) {
      setQuery("")
      setSelectedValue(COMMAND_NO_SELECTION)
    }
  }, [open])

  const filtered = useMemo(() => fuzzyMatchFiles(deferredQuery, files, 100), [deferredQuery, files])

  useEffect(() => {
    if (query.trim() === "") {
      setSelectedValue(COMMAND_NO_SELECTION)
      return
    }
    if (filtered.length > 0 && !filtered.includes(selectedValue)) {
      setSelectedValue(filtered[0]!)
    }
  }, [filtered, query, selectedValue])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader className="sr-only">
        <DialogTitle>Quick open</DialogTitle>
        <DialogDescription>Type a file name…</DialogDescription>
      </DialogHeader>
      <DialogContent className="max-w-[36rem] overflow-hidden p-0" showCloseButton={false}>
        <Command
          className={COMMAND_SHELL_CLASS}
          shouldFilter={false}
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
            placeholder="Type a file name…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList className="max-h-[var(--jet-overlay-list-max)]">
            <CommandEmpty>No matching files.</CommandEmpty>
            <CommandItem value={COMMAND_NO_SELECTION} className="hidden" aria-hidden />
            {filtered.map(path => (
              <CommandItem
                key={path}
                value={path}
                onSelect={() => {
                  onSelect(path)
                  onOpenChange(false)
                }}
              >
                <span className="font-mono">{path}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
