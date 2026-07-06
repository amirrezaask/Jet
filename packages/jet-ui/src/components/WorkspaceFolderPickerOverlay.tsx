import { useDeferredValue, useEffect, useMemo, useState } from "react"
import { Folder } from "lucide-react"
import type { WorkspaceFolder } from "@jet/workspace"
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

function matchFolder(query: string, folder: WorkspaceFolder): boolean {
  if (!query.trim()) return true
  const q = query.toLowerCase()
  return (
    folder.root.name.toLowerCase().includes(q) ||
    folder.root.path.toLowerCase().includes(q)
  )
}

export function WorkspaceFolderPickerOverlay({
  open,
  onOpenChange,
  folders,
  title = "Select workspace folder",
  description = "Choose a folder…",
  onSelect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  folders: WorkspaceFolder[]
  title?: string
  description?: string
  onSelect: (folder: WorkspaceFolder) => void
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

  const filtered = useMemo(
    () => folders.filter(f => matchFolder(deferredQuery, f)),
    [deferredQuery, folders],
  )

  useEffect(() => {
    if (filtered.length === 0) {
      setSelectedValue(COMMAND_NO_SELECTION)
      return
    }
    if (!filtered.some(f => f.id === selectedValue)) {
      setSelectedValue(filtered[0]!.id)
    }
  }, [filtered, selectedValue])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader className="sr-only">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogContent className="max-w-[42rem] overflow-hidden p-0" showCloseButton={false}>
        <Command
          className={COMMAND_SHELL_CLASS}
          shouldFilter={false}
          value={selectedValue}
          onValueChange={setSelectedValue}
        >
          <CommandInput placeholder="Filter folders…" value={query} onValueChange={setQuery} />
          <CommandList className="max-h-[var(--jet-overlay-list-max)]">
            <CommandEmpty>No matching folders.</CommandEmpty>
            <CommandItem value={COMMAND_NO_SELECTION} className="hidden" aria-hidden />
            {filtered.map(folder => (
              <CommandItem
                key={folder.id}
                value={folder.id}
                onSelect={() => {
                  onSelect(folder)
                  onOpenChange(false)
                }}
                className="gap-2"
              >
                <Folder className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="shrink-0 font-mono text-foreground">{folder.root.name}</span>
                  <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                    {folder.root.path}
                  </span>
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
